import { formatString } from './utils';

const { Marked } = (globalThis as any).marked;
const { markedHighlight } = (globalThis as any).markedHighlight;

// PDF Rendering Logic
let totalTime = 0;
let timerInterval: any = null;

async function renderPDF(id: string) {
  totalTime = 0;
  timerInterval = setInterval(async () => {
    totalTime++;
    if (totalTime > 10) {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = null;
      return;
    }
    try {
      const container = document.getElementById(id);
      if (!container) return;
      
      const pdfUrl = container.getAttribute('data-pdf');
      if (!pdfUrl) return;

      const canvas = container.querySelector('canvas');
      if (!canvas) return;

      const pdf = await (globalThis as any).pdfjsLib.getDocument(pdfUrl).promise;
      const page = await pdf.getPage(1);
      // const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const context = canvas.getContext('2d');

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport
      };

      await page.render(renderContext).promise;
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = null;
      return;
    } catch (error: any) {
      console.log("renderPDF error: ", error.message);
    }
  }, 500);
}

// Formatters
const formatCode = (token: any) => {
  let encodeCode;
  const codeBlockRegex = /```\w*\n([\s\S]*?)```/;
  const match = token.raw.match(codeBlockRegex);
  if (match) {
    const codeContent = match[1].trim();
    encodeCode = encodeURIComponent(codeContent);
  } else {
    encodeCode = encodeURIComponent(token.raw);
  }
  return `<div class="code-container">
  <div class="code-header">
    <span class="language-tag">${token.type}</span>
    <button class="copy-btn" data-code="${encodeCode}" title="Copy code">Copy</button>
  </div>
  <pre class="hljs"><code>${token.text}</code></pre>
</div>`;
};

const formatText = (token: any) => {
  let language = (globalThis as any).hljs.getLanguage(token.type) ? token.type : "plaintext";
  const highlightResult = (globalThis as any).hljs.highlight(token.raw, { language }).value;
  return highlightResult;
};

const formatImage = (token: any) => {
  if (token.title === "pdf") {
    return token.text;
  }
  return `<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${token.href}" alt="${token.text}"></img>`;
};

const formatLink = (token: any) => {
  const pattern = /^\[([^\]]+)\]\(([^)]+)\)$/;
  const match = token.raw.match(pattern);
  if (match) {
    const [, linkText, href] = match;
    return `<a href="${href}">${linkText}</a>`;
  }
  return token.text;
};

// Secondary Marked instance for input/think processing
const marked_input = new Marked({
  renderer: {
    html(token: any) {
      token.type = "plaintext";
      return formatText(token);
    },
    link(token: any) {
      token.type = "plaintext";
      return formatText(token);
    },
    text(token: any) {
      if (Object.prototype.hasOwnProperty.call(token, "tokens")) {
        return this.parser.parseInline(token.tokens);
      } else {
        token.type = "plaintext";
        return formatText(token);
      }
    },
  }
});

const renderer = {
  code(token: any) {
    return formatCode(token);
  },
  html(token: any) {
    return formatText(token);
  },
  link(token: any) {
    return formatLink(token);
  },
  image(token: any) {
    return formatImage(token);
  },
  text(token: any) {
    if (Object.prototype.hasOwnProperty.call(token, "tokens")) {
      return this.parser.parseInline(token.tokens);
    } else if (Object.prototype.hasOwnProperty.call(token, "typeThink")) {
      const highlightResult = marked_input.parse(token.text);
      return `<div class="think">${highlightResult}</div>`;
    } else {
      return token.raw;
    }
  },
};

const walkTokens = async (token: any) => {
  if (token.type === 'image') {
    try {
      if (token.href.endsWith('.pdf')) {
        const id = `pdf-canvas-${Date.now()}`;
        // Using a simple replacement since formatString returns HTMLElement which is not suitable here
        // We need HTML string.
        let containerHTML = `<div class="pdf-container" id="${id}" data-pdf="${token.href}">
            <canvas></canvas>
        </div>`;
        token.text = containerHTML;
        token.title = "pdf";
        renderPDF(id);
      }
    } catch {
      token.title = 'invalid';
    }
  }
};

const thinkExtension = {
  name: 'think',
  level: 'block',
  start(src: string) { return src.match(/<think>/)?.index; },
  tokenizer(src: string) {
    const rule0 = /^<think>([\s\S]*?)<\/think>/;
    const match0 = rule0.exec(src);
    const rule1 = /^<think>([\s\S]*)/;
    const match1 = rule1.exec(src);
    const match = match0 || match1;
    if (match) {
      return {
        type: "text",
        typeThink: true,
        raw: match[0],
        text: match[1],
      };
    }
  },
};

function preprocess(src: string) {
  src = src.replace(/\\\(([^]+?)\\\)/g, (match, content) => `$${content}$`);
  src = src.replace(/\\\[([^]+?)\\\]/g, (match, content) => `\n$$${content}$$\n`);
  src = src.replace(/\$\$([^]+?)\$\$/g, (match, content) => `\n$$\n${content}\n$$\n`);
  return src;
}

// Initialize Marked
export const marked = new Marked(
  markedHighlight({
    async: true,
    langPrefix: "hljs language-",
    async highlight(code: string, lang: string) {
      if (lang === 'mermaid') {
        const eleid = 'mermaid-' + Date.now() + '-' + Math.round(Math.random() * 1000);
        try {
          const syntax = await (globalThis as any).mermaid.parse(code);
          if (syntax) {
            const { svg } = await (globalThis as any).mermaid.render(eleid + "-svg", code);
            return `<div id="${eleid}">${svg}</div>`;
          }
        } catch {
          console.log('mermaid format validation failed');
        }
        return `<div id="${eleid}">${code}</div>`;
      }
      let language = (globalThis as any).hljs.getLanguage(lang) ? lang : 'plaintext';
      const hljsResult = await (globalThis as any).hljs.highlight(code, { language });
      return hljsResult.value;
    }
  })
);

marked.use({ hooks: { preprocess } });
marked.use((globalThis as any).markedKatex({ nonStandard: true, async: true }));
marked.use({ walkTokens, renderer, async: true, extensions: [thinkExtension] });

export const initMermaid = () => {
  if ((globalThis as any).mermaid) {
     (globalThis as any).mermaid.initialize({ startOnLoad: false });
  }
};
