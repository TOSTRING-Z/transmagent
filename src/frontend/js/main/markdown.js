const { Marked } = globalThis.marked;
const { markedHighlight } = globalThis.markedHighlight;
// PDF Rendering Logic
let totalTime = 0;
let timerInterval = null;
async function renderPDF(id) {
    totalTime = 0;
    timerInterval = setInterval(async () => {
        totalTime++;
        if (totalTime > 10) {
            if (timerInterval)
                clearInterval(timerInterval);
            timerInterval = null;
            return;
        }
        try {
            const container = document.getElementById(id);
            if (!container)
                return;
            const pdfUrl = container.getAttribute('data-pdf');
            if (!pdfUrl)
                return;
            const canvas = container.querySelector('canvas');
            if (!canvas)
                return;
            const pdf = await globalThis.pdfjsLib.getDocument(pdfUrl).promise;
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
            if (timerInterval)
                clearInterval(timerInterval);
            timerInterval = null;
            return;
        }
        catch (error) {
            console.log("renderPDF error: ", error.message);
        }
    }, 500);
}
// 1. 将方法挂载到 globalThis 上，并直接接收 element 而不是 event
globalThis.copyCode = (btn, event) => {
    if (event)
        event.stopPropagation();
    const codeToCopy = decodeURIComponent(btn.getAttribute('data-code') || '');
    navigator.clipboard.writeText(codeToCopy).then(() => {
        // Add visual feedback
        btn.classList.add('copied');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = originalText;
        }, 1500);
    }).catch(err => {
        console.log('Copy failed', err);
    });
};
// Toggle code block collapse/expand
globalThis.toggleCodeCollapse = (element, event) => {
    if (event)
        event.stopPropagation();
    // Find the container
    const container = element.closest('.code-container');
    if (!container)
        return;
    const contentDiv = container.querySelector('.code-content');
    const collapseBtn = container.querySelector('.collapse-btn');
    const fadeHint = container.querySelector('.code-fade-hint');
    const lineCount = fadeHint?.getAttribute('data-line-count') || '10';
    const isCollapsed = container.getAttribute('data-collapsed') === 'true';
    if (isCollapsed) {
        // Expand
        contentDiv?.classList.remove('collapsed');
        container.setAttribute('data-collapsed', 'false');
        if (fadeHint) {
            fadeHint.innerHTML = '<i class="fas fa-arrow-up"></i> Collapse';
        }
        if (collapseBtn) {
            collapseBtn.style.display = 'flex';
            collapseBtn.title = 'Collapse';
            collapseBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
        }
    }
    else {
        // Collapse
        contentDiv?.classList.add('collapsed');
        container.setAttribute('data-collapsed', 'true');
        if (fadeHint) {
            fadeHint.innerHTML = `<i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines`;
        }
        if (collapseBtn) {
            collapseBtn.style.display = 'none';
        }
    }
};
// Formatters
const formatCode = (token) => {
    let encodeCode;
    const codeBlockRegex = /```\w*\n([\s\S]*?)```/;
    const match = token.raw.match(codeBlockRegex);
    if (match) {
        const codeContent = match[1].trim();
        encodeCode = encodeURIComponent(codeContent);
    }
    else {
        encodeCode = encodeURIComponent(token.raw);
    }
    // Count lines and determine if collapse is needed
    const codeLines = token.text.split('\n');
    const lineCount = codeLines.length;
    const shouldCollapse = lineCount > 6;
    return `<div class="code-container" data-collapsed="${shouldCollapse ? 'true' : 'false'}">
  <div class="code-header">
    <div class="code-header-left">
      <span class="language-tag">${token.type}</span>
      <span class="line-count">${lineCount} lines</span>
    </div>
    <div class="code-header-right">
      <button class="collapse-btn" onclick="toggleCodeCollapse(this, event)" title="Collapse" style="display: none;">
        <i class="fas fa-chevron-down"></i>
      </button>
      <button class="copy-btn" onclick="copyCode(this, event)" data-code="${encodeCode}" title="Copy code">Copy</button>
    </div>
  </div>
  <div class="code-content${shouldCollapse ? ' collapsed' : ''}">
    <pre class="hljs"><code>${token.text}</code></pre>
  </div>
  <div class="code-fade-overlay">
    <span class="code-fade-hint" onclick="toggleCodeCollapse(this, event)" data-line-count="${lineCount}">
      <i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines
    </span>
  </div>
</div>`;
};
const formatText = (token) => {
    let language = globalThis.hljs.getLanguage(token.type) ? token.type : "plaintext";
    const highlightResult = globalThis.hljs.highlight(token.raw, { language }).value;
    return highlightResult;
};
const formatImage = (token) => {
    if (token.title === "pdf") {
        return token.text;
    }
    return `<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${token.href}" alt="${token.text}"></img>`;
};
const formatLink = (token) => {
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
        html(token) {
            token.type = "plaintext";
            return formatText(token);
        },
        link(token) {
            token.type = "plaintext";
            return formatText(token);
        },
        text(token) {
            if (Object.prototype.hasOwnProperty.call(token, "tokens")) {
                return this.parser.parseInline(token.tokens);
            }
            else {
                token.type = "plaintext";
                return formatText(token);
            }
        },
    }
});
const renderer = {
    code(token) {
        return formatCode(token);
    },
    html(token) {
        return formatText(token);
    },
    link(token) {
        return formatLink(token);
    },
    image(token) {
        return formatImage(token);
    },
    text(token) {
        if (Object.prototype.hasOwnProperty.call(token, "tokens")) {
            return this.parser.parseInline(token.tokens);
        }
        else if (Object.prototype.hasOwnProperty.call(token, "typeThink")) {
            const highlightResult = marked_input.parse(token.text);
            return `<div class="think">${highlightResult}</div>`;
        }
        else {
            return token.raw;
        }
    },
};
const walkTokens = async (token) => {
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
        }
        catch {
            token.title = 'invalid';
        }
    }
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
                type: "text",
                typeThink: true,
                raw: match[0],
                text: match[1],
            };
        }
    },
};
function preprocess(src) {
    src = src.replace(/\\\(([^]+?)\\\)/g, (match, content) => `$${content}$`);
    src = src.replace(/\\\[([^]+?)\\\]/g, (match, content) => `\n$$${content}$$\n`);
    src = src.replace(/\$\$([^]+?)\$\$/g, (match, content) => `\n$$\n${content}\n$$\n`);
    return src;
}
// Initialize Marked
export const marked = new Marked(markedHighlight({
    async: true,
    langPrefix: "hljs language-",
    async highlight(code, lang) {
        if (lang === 'mermaid') {
            const eleid = 'mermaid-' + Date.now() + '-' + Math.round(Math.random() * 1000);
            try {
                const syntax = await globalThis.mermaid.parse(code);
                if (syntax) {
                    const { svg } = await globalThis.mermaid.render(eleid + "-svg", code);
                    return `<div id="${eleid}">${svg}</div>`;
                }
            }
            catch {
                console.log('mermaid format validation failed');
            }
            return `<div id="${eleid}">${code}</div>`;
        }
        let language = globalThis.hljs.getLanguage(lang) ? lang : 'plaintext';
        const hljsResult = await globalThis.hljs.highlight(code, { language });
        return hljsResult.value;
    }
}));
marked.use({ hooks: { preprocess } });
marked.use(globalThis.markedKatex({ nonStandard: true, async: true }));
marked.use({ walkTokens, renderer, async: true, extensions: [thinkExtension] });
export const initMermaid = () => {
    if (globalThis.mermaid) {
        globalThis.mermaid.initialize({ startOnLoad: false });
    }
};
