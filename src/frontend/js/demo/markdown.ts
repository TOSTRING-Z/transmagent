// @ts-nocheck
// 演示模式独立 Markdown 渲染层 - 镜像 src/frontend/js/main/markdown.ts 的配置

const { Marked } = (globalThis as any).marked;
const { markedHighlight } = (globalThis as any).markedHighlight;

let mermaidInitialized = false;

function initMermaid() {
  if (!mermaidInitialized && (globalThis as any).mermaid) {
    (globalThis as any).mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
    });
    mermaidInitialized = true;
  }
}

// 代码块格式器：含复制 + 折叠
const formatCode = (token: any) => {
  const codeBlockRegex = /```\w*\n([\s\S]*?)```/;
  const match = token.raw.match(codeBlockRegex);
  const codeContent = match ? match[1].trim() : token.raw;
  const encodeCode = encodeURIComponent(codeContent);

  const codeLines = token.text.split('\n');
  const lineCount = codeLines.length;
  const shouldCollapse = lineCount > 6;
  const lang = token.type || 'plaintext';

  return `<div class="code-container" data-collapsed="${shouldCollapse ? 'true' : 'false'}">
  <div class="code-header">
    <div class="code-header-left">
      <span class="language-tag">${lang}</span>
      <span class="line-count">${lineCount} lines</span>
    </div>
    <div class="code-header-right">
      <button class="collapse-btn" onclick="window.toggleCodeCollapse(this, event)" title="Collapse" style="display: none;">
        <i class="fas fa-chevron-down"></i>
      </button>
      <button class="copy-btn" onclick="window.copyCode(this, event)" data-code="${encodeCode}" title="Copy code">Copy</button>
    </div>
  </div>
  <div class="code-content${shouldCollapse ? ' collapsed' : ''}">
    <pre class="hljs"><code>${token.text}</code></pre>
  </div>
  <div class="code-fade-overlay">
    <span class="code-fade-hint" onclick="window.toggleCodeCollapse(this, event)" data-line-count="${lineCount}">
      <i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines
    </span>
  </div>
</div>`;
};

const formatText = (token: any) => {
  let language = (globalThis as any).hljs.getLanguage(token.type) ? token.type : 'plaintext';
  const result = (globalThis as any).hljs.highlight(token.raw, { language });
  return result.value;
};

const formatLink = (token: any) => {
  const pattern = /^\[([^\]]+)\]\(([^)]+)\)$/;
  const match = token.raw.match(pattern);
  if (match) {
    const [, linkText, href] = match;
    return `<a href="${href}" target="_blank" rel="noopener">${linkText}</a>`;
  }
  return token.text;
};

const formatImage = (token: any) => {
  return `<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${token.href}" alt="${token.text}"></img>`;
};

const thinkExtension = {
  name: 'thinking',
  level: 'block',
  start(src) { return src.match(/<thinking>/)?.index; },
  tokenizer(src) {
    const rule0 = /^<thinking>([\s\S]*?)<\/thinking>/;
    const match0 = rule0.exec(src);
    const rule1 = /^<thinking>([\s\S]*)/;
    const match1 = rule1.exec(src);
    const match = match0 || match1;
    if (match) {
      return {
        type: 'text',
        typeThink: true,
        raw: match[0],
        text: match[1],
      };
    }
  },
};

function preprocess(src: string) {
  src = src.replace(/\\\(([^]+?)\\\)/g, (_m, c) => `$${c}$`);
  src = src.replace(/\\\[([^]+?)\\\]/g, (_m, c) => `\n$$${c}$$\n`);
  src = src.replace(/\$\$([^]+?)\$\$/g, (_m, c) => `\n$$\n${c}\n$$\n`);
  return src;
}

const marked_input = new Marked({
  renderer: {
    html(token: any) { token.type = 'plaintext'; return formatText(token); },
    link(token: any) { token.type = 'plaintext'; return formatText(token); },
    text(token: any) {
      if (Object.prototype.hasOwnProperty.call(token, 'tokens')) {
        return this.parser.parseInline(token.tokens);
      } else {
        token.type = 'plaintext';
        return formatText(token);
      }
    },
  }
});

const renderer: any = {
  code(token: any) { return formatCode(token); },
  html(token: any) { return formatText(token); },
  link(token: any) { return formatLink(token); },
  image(token: any) { return formatImage(token); },
  text(token: any) {
    if (Object.prototype.hasOwnProperty.call(token, 'tokens')) {
      return this.parser.parseInline(token.tokens);
    } else if (Object.prototype.hasOwnProperty.call(token, 'typeThink')) {
      const highlightResult = marked_input.parse(token.text);
      return `<div class="think">${highlightResult}</div>`;
    } else {
      return token.raw;
    }
  },
};

export const marked = new Marked(
  markedHighlight({
    async: true,
    langPrefix: 'hljs language-',
    async highlight(code: string, lang: string) {
      if (lang === 'mermaid') {
        const eleid = 'mermaid-' + Date.now() + '-' + Math.round(Math.random() * 1000);
        try {
          initMermaid();
          await (globalThis as any).mermaid.parse(code);
          const { svg } = await (globalThis as any).mermaid.render(eleid + '-svg', code);
          return `<div class="mermaid-diagram" id="${eleid}">${svg}</div>`;
        } catch (e) {
          return `<pre class="hljs"><code>${code}</code></pre>`;
        }
      }
      let language = (globalThis as any).hljs.getLanguage(lang) ? lang : 'plaintext';
      const result = await (globalThis as any).hljs.highlight(code, { language });
      return result.value;
    }
  })
);

marked.use({ hooks: { preprocess } });
marked.use((globalThis as any).markedKatex({ nonStandard: true, async: true }));
marked.use({ renderer, async: true, extensions: [thinkExtension] });

// 挂载全局函数供代码块按钮使用
(globalThis as any).copyCode = (btn: HTMLElement, event?: Event) => {
  if (event) event.stopPropagation();
  const codeToCopy = decodeURIComponent(btn.getAttribute('data-code') || '');
  navigator.clipboard.writeText(codeToCopy).then(() => {
    btn.classList.add('copied');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = originalText;
    }, 1500);
  }).catch(err => console.log('Copy failed', err));
};

(globalThis as any).toggleCodeCollapse = (element: HTMLElement, event?: Event) => {
  if (event) event.stopPropagation();
  const container = element.closest('.code-container');
  if (!container) return;
  const contentDiv = container.querySelector('.code-content');
  const collapseBtn = container.querySelector('.collapse-btn');
  const fadeHint = container.querySelector('.code-fade-hint');
  const lineCount = fadeHint?.getAttribute('data-line-count') || '10';
  const isCollapsed = container.getAttribute('data-collapsed') === 'true';

  if (isCollapsed) {
    contentDiv?.classList.remove('collapsed');
    container.setAttribute('data-collapsed', 'false');
    if (fadeHint) fadeHint.innerHTML = '<i class="fas fa-arrow-up"></i> Collapse';
    if (collapseBtn) {
      collapseBtn.style.display = 'flex';
      collapseBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
    }
  } else {
    contentDiv?.classList.add('collapsed');
    container.setAttribute('data-collapsed', 'true');
    if (fadeHint) fadeHint.innerHTML = `<i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines`;
    if (collapseBtn) collapseBtn.style.display = 'none';
  }
};

export async function renderMarkdown(content: string): Promise<string> {
  return await marked.parse(content);
}