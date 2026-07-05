"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };

  // demo/data.ts
  var BUILT_IN_SCRIPT = {
    title: "TransMAgent \xB7 \u6F14\u793A\u6A21\u5F0F",
    scenario: "\u5355\u7EC6\u80DE\u8F6C\u5F55\u7EC4\u7EC6\u80DE\u7C7B\u578B\u6CE8\u91CA \xB7 8 \u6761\u6D88\u606F \xB7 \u9ED8\u8BA4\u95F4\u9694 2s",
    totalDurationHint: "\u7EA6 16 \u79D2",
    messages: [
      {
        role: "user",
        content: "\u6211\u6709\u4E00\u4E2A **10x Genomics** \u5355\u7EC6\u80DE RNA-seq \u6570\u636E\u96C6\uFF08PBMC\uFF0C~3000 \u4E2A\u7EC6\u80DE\uFF09\u3002\u8BF7\u5E2E\u6211\u505A\u4E0B\u6E38\u5206\u6790\uFF0C\u91CD\u70B9\u8BC6\u522B T \u7EC6\u80DE\u4E9A\u7FA4\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: "\u597D\u7684\uFF01\u6211\u5C06\u4F7F\u7528 **scanpy** \u6846\u67B6\u8FDB\u884C\u6807\u51C6\u5206\u6790\u3002\u6574\u4F53\u6D41\u7A0B\u5982\u4E0B\uFF1A\n\n```mermaid\nflowchart TD\n  A[\u539F\u59CB\u6570\u636E .h5ad] --> B[\u8D28\u63A7 QC]\n  B --> C[\u5F52\u4E00\u5316\u4E0E\u5BF9\u6570\u5316]\n  C --> D[\u9AD8\u53D8\u57FA\u56E0 HVG]\n  D --> E[PCA \u964D\u7EF4]\n  E --> F[\u6784\u5EFA\u90BB\u63A5\u56FE]\n  F --> G[UMAP \u53EF\u89C6\u5316]\n  G --> H[Leiden \u805A\u7C7B]\n  H --> I[\u7EC6\u80DE\u7C7B\u578B\u6CE8\u91CA]\n```\n\n\u8BA9\u6211\u5148\u626B\u63CF\u4E00\u4E0B\u53EF\u7528\u7684\u5DE5\u5177\u3002"
      },
      {
        role: "tool",
        icon: "tool",
        info: "```python\n# \u626B\u63CF MCP \u5DE5\u5177\u5217\u8868\ntools = mcp.scanpy.list_tools()\n# \u8FD4\u56DE: scanpy.pp, scanpy.tl, scanpy.pl (\u5171 42 \u4E2A)\n```",
        content: "\u5DF2\u52A0\u8F7D **42 \u4E2A** scanpy \u76F8\u5173\u5DE5\u5177\u3002\u4E0B\u4E00\u6B65\u6211\u5C06\u6267\u884C\u5B8C\u6574\u5206\u6790\u7BA1\u7EBF\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: "### \u7B2C\u4E00\u6B65\uFF1A\u8D28\u91CF\u63A7\u5236\n\n| \u6307\u6807 | \u8FC7\u6EE4\u524D | \u8FC7\u6EE4\u540E |\n|------|--------|--------|\n| \u7EC6\u80DE\u6570 | 3,247 | 2,891 |\n| \u57FA\u56E0\u4E2D\u4F4D\u6570 | 1,847 | 1,623 |\n| \u7EBF\u7C92\u4F53\u57FA\u56E0 % | 8.4% | 2.1% |\n\n> \u901A\u8FC7 `nFeature_RNA > 200`\u3001`nFeature_RNA < 5000`\u3001`percent.mt < 10` \u4E09\u91CD\u8FC7\u6EE4\uFF0C\u79FB\u9664\u4E86 **356 \u4E2A** \u4F4E\u8D28\u91CF\u7EC6\u80DE\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: "### \u7B2C\u4E8C\u6B65\uFF1A\u805A\u7C7B\u4E0E\u53EF\u89C6\u5316\n\n\u5B8C\u6210 Leiden \u805A\u7C7B\u540E\u5171\u8BC6\u522B\u51FA **7 \u4E2A** \u4E3B\u8981\u7EC6\u80DE\u7FA4\u3002\u7ED3\u5408\u5DEE\u5F02\u8868\u8FBE\u57FA\u56E0\u8FDB\u884C\u81EA\u52A8\u6CE8\u91CA\uFF0C\u7ED3\u679C\u5982\u4E0B\uFF1A\n\n- **CD3D+, CD3E+, TRAC+** \u2192 T \u7EC6\u80DE\uFF08\u5360\u603B\u7EC6\u80DE 42.3%\uFF09\n- **CD14+, LYZ+** \u2192 \u5355\u6838\u7EC6\u80DE\uFF0818.7%\uFF09\n- **MS4A1+, CD79A+** \u2192 B \u7EC6\u80DE\uFF0815.2%\uFF09\n- **NKG7+, GNLY+** \u2192 NK \u7EC6\u80DE\uFF089.1%\uFF09\n- **FCGR3A+, MS4A7+** \u2192 CD16+ \u5355\u6838\uFF086.4%\uFF09\n- **PPBP+, PF4+** \u2192 \u8840\u5C0F\u677F\uFF084.8%\uFF09\n- **IL3RA+, LILRA4+** \u2192 \u6811\u7A81\u72B6\u7EC6\u80DE\uFF083.5%\uFF09"
      },
      {
        role: "system",
        icon: "agent",
        content: "### \u7B2C\u4E09\u6B65\uFF1AT \u7EC6\u80DE\u4E9A\u7FA4\u7EC6\u5206\n\n\u5BF9 T \u7EC6\u80DE\u7FA4\u8FDB\u884C\u4E9A\u805A\u7C7B\uFF0C\u5F97\u5230 **4 \u4E2A** \u4E9A\u7FA4\u3002\u5173\u952E\u5DEE\u5F02\u8868\u8FBE\u57FA\u56E0\uFF1A\n\n- **CD4+ T**\uFF1A`IL7R`, `CCR7`, `TCF7`\n- **CD8+ T (naive)**\uFF1A`CD8A`, `CD8B`, `CCR7`\n- **CD8+ T (effector)**\uFF1A`GZMB`, `PRF1`, `NKG7`\n- **Treg**\uFF1A`FOXP3`, `IL2RA`, `CTLA4`\n\n\u5DEE\u5F02\u8868\u8FBE\u7EDF\u8BA1\u663E\u8457\u6027\u91C7\u7528 Wilcoxon \u79E9\u548C\u68C0\u9A8C\uFF0C\u8C03\u6574\u540E p \u503C\u9608\u503C\u4E3A $p_{adj} < 0.05$\u3002"
      },
      {
        role: "user",
        content: "\u592A\u68D2\u4E86\uFF01\u80FD\u7ED9\u6211\u5C55\u793A\u4E00\u4E0B **CD8+ T \u7EC6\u80DE**\u7684\u5DEE\u5F02\u8868\u8FBE\u57FA\u56E0\u70ED\u56FE\u5417\uFF1F\n\n\u516C\u5F0F\u53C2\u8003\uFF1A\n\n$$\n\\mathrm{score}_i = \\frac{1}{|G|}\\sum_{g \\in G} \\log_2\\left(\\frac{x_{i,g} + 1}{\\bar{x}_{g} + 1}\\right)\n$$\n\n\u5176\u4E2D $G$ \u4E3A\u6807\u8BB0\u57FA\u56E0\u96C6\u5408\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: '```python\nimport scanpy as sc\n\n# \u9009\u53D6 CD8+ T \u7EC6\u80DE\u4E9A\u7FA4\ncd8 = adata[adata.obs["cell_type"].isin([\n    "CD8+ T (naive)", "CD8+ T (effector)"\n])]\n\n# \u627E\u5DEE\u5F02\u57FA\u56E0\nsc.tl.rank_genes_groups(cd8, groupby="cell_type", method="wilcoxon")\n\n# \u7ED8\u5236\u70ED\u56FE\nsc.pl.rank_genes_groups_heatmap(\n    cd8, n_genes=10, show_gene_labels=True,\n    figsize=(8, 6), save="_cd8_heatmap.pdf"\n)\n```\n\n\u70ED\u56FE\u5DF2\u751F\u6210\u81F3 `./figures/cd8_heatmap.pdf`\u3002\u53EF\u4EE5\u770B\u5230 effector \u7FA4\u4F53\u663E\u8457\u4E0A\u8C03 **GZMB\u3001PRF1\u3001GZMA\u3001NKG7** \u7B49\u7EC6\u80DE\u6BD2\u6027\u57FA\u56E0\uFF0Cnaive \u7FA4\u4F53\u5219\u9AD8\u8868\u8FBE **CCR7\u3001SELL\u3001TCF7** \u7B49\u5F52\u5DE2\u76F8\u5173\u57FA\u56E0\u2014\u2014\u8FD9\u4E0E\u514D\u75AB\u5B66\u9884\u671F\u4E00\u81F4\u3002\n\n> \u{1F4CA} \u5206\u6790\u62A5\u544A\u4E0E\u5168\u90E8\u56FE\u8868\u5DF2\u4FDD\u5B58\u81F3\u5DE5\u4F5C\u533A\uFF0C\u53EF\u901A\u8FC7\u300CEnvironment Variables\u300D\u9762\u677F\u67E5\u770B\u8DEF\u5F84\u3002'
      }
    ]
  };
  var TF_NETWORK_SCRIPT = {
    title: "TransMAgent \xB7 \u6F14\u793A\u6A21\u5F0F \xB7 \u8F6C\u5F55\u56E0\u5B50\u8C03\u63A7",
    scenario: "TF \u8C03\u63A7\u7F51\u7EDC\u63A8\u65AD \xB7 6 \u6761\u6D88\u606F",
    totalDurationHint: "\u7EA6 12 \u79D2",
    messages: [
      {
        role: "user",
        content: "\u8BF7\u5E2E\u6211\u4ECE\u8FD9\u4EFD ATAC-seq \u6570\u636E\u63A8\u65AD **\u5173\u952E\u8F6C\u5F55\u56E0\u5B50 (TF)** \u53CA\u5176\u9776\u57FA\u56E0\u7F51\u7EDC\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: "\u6211\u5C06\u91C7\u7528 **pycistopic** + **GRNBoost2** \u7684\u7EC4\u5408\u65B9\u6848\uFF1A\n\n```python\nfrom pycistarget.utils import calculate_pseudobulk\n# 1. \u4F2A\u6279\u91CF ATAC\n# 2. cisTopic \u4E3B\u9898\u5EFA\u6A21\n# 3. \u4E3B\u9898-\u57FA\u5E8F\u5173\u8054\n# 4. GRNBoost2 \u6784\u5EFA\u8C03\u63A7\u7F51\u7EDC\n```"
      },
      {
        role: "system",
        icon: "agent",
        content: "### \u5019\u9009 TF \u6392\u540D\uFF08\u524D 5\uFF09\n\n| \u6392\u540D | TF | NES | \u9776\u57FA\u56E0\u6570 | \u8C03\u63A7\u65B9\u5411 |\n|------|-----|------|---------|---------|\n| 1 | **MYC** | 5.82 | 1,247 | \u6FC0\u6D3B |\n| 2 | **STAT1** | 4.96 | 892 | \u6FC0\u6D3B |\n| 3 | **E2F1** | 4.31 | 763 | \u6FC0\u6D3B |\n| 4 | **NFKB1** | 3.78 | 1,103 | \u6FC0\u6D3B/\u6291\u5236 |\n| 5 | **FOXP3** | 3.21 | 412 | \u6291\u5236 |"
      },
      {
        role: "tool",
        icon: "tool",
        info: "GRNBoost2 \u5DF2\u5B8C\u6210\u57FA\u4E8E 50,000 \u4E2A ATAC peaks \u7684\u8C03\u63A7\u63A8\u65AD\uFF0C\u8FD0\u884C\u8017\u65F6 18.4s\u3002",
        content: "\u8C03\u63A7\u7F51\u7EDC\u63A8\u65AD\u5B8C\u6210\uFF0C\u8282\u70B9\u6570 2,341\uFF0C\u8FB9\u6570 8,927\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: "### \u53EF\u89C6\u5316\n\n```mermaid\ngraph LR\n  MYC --> CCNA2\n  MYC --> CDK4\n  MYC --> CCND1\n  STAT1 --> IFIT1\n  STAT1 --> OAS1\n  NFKB1 --> TNFAIP3\n  NFKB1 --> BCL2L1\n```\n\n\u5173\u952E\u53CD\u9988\u56DE\u8DEF **MYC \u2192 CCND1 \u2192 CDK4** \u63D0\u793A\u7EC6\u80DE\u5468\u671F G1/S \u8F6C\u6362\u6D3B\u8DC3\u3002"
      },
      {
        role: "system",
        icon: "agent",
        content: "\u5206\u6790\u5B8C\u6210\u3002\u5DF2\u8BC6\u522B **MYC/STAT1/NFKB1** \u4E3A\u8BE5\u6570\u636E\u96C6\u7684\u6838\u5FC3\u8C03\u63A7\u8282\u70B9\uFF0C\u5EFA\u8BAE\u4E0B\u6E38\u8FDB\u884C ChIP-seq \u9A8C\u8BC1\u3002\n\n> \u{1F4C1} \u7ED3\u679C\u6587\u4EF6\uFF1A`output/grn_network.html`\uFF08\u4EA4\u4E92\u5F0F\u7F51\u7EDC\u56FE\uFF09"
      }
    ]
  };

  // demo/markdown.ts
  var { Marked } = globalThis.marked;
  var { markedHighlight } = globalThis.markedHighlight;
  var mermaidInitialized = false;
  function initMermaid() {
    if (!mermaidInitialized && globalThis.mermaid) {
      globalThis.mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose"
      });
      mermaidInitialized = true;
    }
  }
  var formatCode = (token) => {
    const codeBlockRegex = /```\w*\n([\s\S]*?)```/;
    const match = token.raw.match(codeBlockRegex);
    const codeContent = match ? match[1].trim() : token.raw;
    const encodeCode = encodeURIComponent(codeContent);
    const codeLines = token.text.split("\n");
    const lineCount = codeLines.length;
    const shouldCollapse = lineCount > 6;
    const lang = token.type || "plaintext";
    return `<div class="code-container" data-collapsed="${shouldCollapse ? "true" : "false"}">
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
  <div class="code-content${shouldCollapse ? " collapsed" : ""}">
    <pre class="hljs"><code>${token.text}</code></pre>
  </div>
  <div class="code-fade-overlay">
    <span class="code-fade-hint" onclick="window.toggleCodeCollapse(this, event)" data-line-count="${lineCount}">
      <i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines
    </span>
  </div>
</div>`;
  };
  var formatText = (token) => {
    let language = globalThis.hljs.getLanguage(token.type) ? token.type : "plaintext";
    const result = globalThis.hljs.highlight(token.raw, { language });
    return result.value;
  };
  var formatLink = (token) => {
    const pattern = /^\[([^\]]+)\]\(([^)]+)\)$/;
    const match = token.raw.match(pattern);
    if (match) {
      const [, linkText, href] = match;
      return `<a href="${href}" target="_blank" rel="noopener">${linkText}</a>`;
    }
    return token.text;
  };
  var formatImage = (token) => {
    return `<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${token.href}" alt="${token.text}"></img>`;
  };
  var thinkExtension = {
    name: "thinking",
    level: "block",
    start(src) {
      return src.match(/<thinking>/)?.index;
    },
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
          text: match[1]
        };
      }
    }
  };
  function preprocess(src) {
    src = src.replace(/\\\(([^]+?)\\\)/g, (_m, c) => `$${c}$`);
    src = src.replace(/\\\[([^]+?)\\\]/g, (_m, c) => `
$$${c}$$
`);
    src = src.replace(/\$\$([^]+?)\$\$/g, (_m, c) => `
$$
${c}
$$
`);
    return src;
  }
  var marked_input = new Marked({
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
        } else {
          token.type = "plaintext";
          return formatText(token);
        }
      }
    }
  });
  var renderer = {
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
      } else if (Object.prototype.hasOwnProperty.call(token, "typeThink")) {
        const highlightResult = marked_input.parse(token.text);
        return `<div class="think">${highlightResult}</div>`;
      } else {
        return token.raw;
      }
    }
  };
  var marked = new Marked(
    markedHighlight({
      async: true,
      langPrefix: "hljs language-",
      async highlight(code, lang) {
        if (lang === "mermaid") {
          const eleid = "mermaid-" + Date.now() + "-" + Math.round(Math.random() * 1e3);
          try {
            initMermaid();
            await globalThis.mermaid.parse(code);
            const { svg } = await globalThis.mermaid.render(eleid + "-svg", code);
            return `<div class="mermaid-diagram" id="${eleid}">${svg}</div>`;
          } catch (e) {
            return `<pre class="hljs"><code>${code}</code></pre>`;
          }
        }
        let language = globalThis.hljs.getLanguage(lang) ? lang : "plaintext";
        const result = await globalThis.hljs.highlight(code, { language });
        return result.value;
      }
    })
  );
  marked.use({ hooks: { preprocess } });
  marked.use(globalThis.markedKatex({ nonStandard: true, async: true }));
  marked.use({ renderer, async: true, extensions: [thinkExtension] });
  globalThis.copyCode = (btn, event) => {
    if (event)
      event.stopPropagation();
    const codeToCopy = decodeURIComponent(btn.getAttribute("data-code") || "");
    navigator.clipboard.writeText(codeToCopy).then(() => {
      btn.classList.add("copied");
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = originalText;
      }, 1500);
    }).catch((err) => console.log("Copy failed", err));
  };
  globalThis.toggleCodeCollapse = (element, event) => {
    if (event)
      event.stopPropagation();
    const container = element.closest(".code-container");
    if (!container)
      return;
    const contentDiv = container.querySelector(".code-content");
    const collapseBtn = container.querySelector(".collapse-btn");
    const fadeHint = container.querySelector(".code-fade-hint");
    const lineCount = fadeHint?.getAttribute("data-line-count") || "10";
    const isCollapsed = container.getAttribute("data-collapsed") === "true";
    if (isCollapsed) {
      contentDiv?.classList.remove("collapsed");
      container.setAttribute("data-collapsed", "false");
      if (fadeHint)
        fadeHint.innerHTML = '<i class="fas fa-arrow-up"></i> Collapse';
      if (collapseBtn) {
        collapseBtn.style.display = "flex";
        collapseBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
      }
    } else {
      contentDiv?.classList.add("collapsed");
      container.setAttribute("data-collapsed", "true");
      if (fadeHint)
        fadeHint.innerHTML = `<i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines`;
      if (collapseBtn)
        collapseBtn.style.display = "none";
    }
  };
  async function renderMarkdown(content) {
    return await marked.parse(content);
  }

  // demo/main.ts
  var DemoPlayer = class {
    constructor(script) {
      __publicField(this, "script");
      __publicField(this, "index", 0);
      __publicField(this, "maxIndex", -1);
      __publicField(this, "isPlaying", false);
      __publicField(this, "timer", null);
      __publicField(this, "pingpongDir", 1);
      __publicField(this, "pingpongDone", false);
      __publicField(this, "interval", 2e3);
      __publicField(this, "speed", 1);
      __publicField(this, "loopMode", "none");
      __publicField(this, "onStateChange", () => {
      });
      __publicField(this, "onRender", async () => {
      });
      __publicField(this, "onProgress", () => {
      });
      this.script = script;
    }
    get total() {
      return this.script.messages.length;
    }
    get currentIndex() {
      return this.index;
    }
    get playing() {
      return this.isPlaying;
    }
    get currentScript() {
      return this.script;
    }
    setScript(script) {
      this.pause();
      this.script = script;
      this.index = 0;
      this.maxIndex = -1;
      this.pingpongDir = 1;
      this.pingpongDone = false;
      this.onProgress(0, script.messages.length);
      this.onStateChange();
    }
    setInterval(ms) {
      this.interval = Math.max(200, Math.min(1e4, Math.round(ms)));
      this.onStateChange();
    }
    setSpeed(s) {
      this.speed = s;
      this.onStateChange();
    }
    setLoopMode(mode) {
      this.loopMode = mode;
      this.pingpongDir = 1;
      this.onStateChange();
    }
    get effectiveDelay() {
      return Math.max(100, this.interval / this.speed);
    }
    async play() {
      if (this.isPlaying)
        return;
      if (this.index >= this.total) {
        this.index = 0;
      }
      this.isPlaying = true;
      this.pingpongDone = false;
      this.onStateChange();
      await this.renderCurrent();
      this.scheduleNext();
    }
    pause() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.isPlaying = false;
      this.onStateChange();
    }
    stop() {
      this.pause();
      this.index = 0;
      this.maxIndex = -1;
      this.pingpongDir = 1;
      this.pingpongDone = false;
      this.onProgress(0, this.total);
      const messages = document.getElementById("messages");
      if (messages)
        messages.innerHTML = "";
      this.onStateChange();
    }
    async next() {
      this.pause();
      if (this.index < this.total) {
        this.index++;
        if (this.index > this.maxIndex) {
          await this.renderCurrent();
        } else {
          this.onProgress(this.index + 1, this.total);
        }
      }
      this.onStateChange();
    }
    async prev() {
      this.pause();
      if (this.index > 0) {
        this.index--;
        this.onProgress(this.index + 1, this.total);
      }
      this.onStateChange();
    }
    async jumpTo(target) {
      this.pause();
      target = Math.max(0, Math.min(this.total - 1, target));
      const messages = document.getElementById("messages");
      if (!messages)
        return;
      if (target > this.maxIndex) {
        for (let i = this.maxIndex + 1; i <= target; i++) {
          const msg = this.script.messages[i];
          await this.appendMessage(msg, i);
        }
      } else if (target < this.index) {
        const toRemove = this.index - target;
        for (let i = 0; i < toRemove; i++) {
          if (messages.lastElementChild)
            messages.removeChild(messages.lastElementChild);
        }
        this.maxIndex = target;
      }
      this.index = target;
      this.onProgress(this.index + 1, this.total);
      this.onStateChange();
      scrollToBottom();
    }
    scheduleNext() {
      if (!this.isPlaying)
        return;
      const delay = this.effectiveDelay;
      const msg = this.script.messages[this.index];
      const customDelay = msg?.delay;
      const finalDelay = customDelay ?? delay;
      this.timer = setTimeout(async () => {
        this.timer = null;
        if (!this.isPlaying)
          return;
        this.index++;
        if (this.index >= this.total) {
          if (this.loopMode === "loop") {
            const messages = document.getElementById("messages");
            if (messages)
              messages.innerHTML = "";
            this.index = 0;
            this.maxIndex = -1;
            await this.renderCurrent();
            this.scheduleNext();
            return;
          } else if (this.loopMode === "pingpong") {
            if (this.pingpongDone) {
              this.isPlaying = false;
              this.onStateChange();
              return;
            }
            this.pingpongDir = -1;
            this.index = this.total - 2;
            const messages = document.getElementById("messages");
            if (messages)
              messages.innerHTML = "";
            this.maxIndex = -1;
            for (let i = 0; i <= this.index + 1; i++) {
              await this.appendMessage(this.script.messages[i], i);
            }
            this.scheduleNextReverse();
            return;
          } else {
            this.isPlaying = false;
            this.onStateChange();
            return;
          }
        }
        await this.renderCurrent();
        this.scheduleNext();
      }, finalDelay);
    }
    scheduleNextReverse() {
      if (!this.isPlaying)
        return;
      const delay = this.effectiveDelay;
      this.timer = setTimeout(async () => {
        this.timer = null;
        if (!this.isPlaying)
          return;
        this.index--;
        if (this.index < 0) {
          this.pingpongDone = true;
          this.isPlaying = false;
          this.onStateChange();
          return;
        }
        const messages = document.getElementById("messages");
        if (messages && messages.lastElementChild) {
          messages.removeChild(messages.lastElementChild);
        }
        this.maxIndex = this.index;
        this.onProgress(this.index + 1, this.total);
        this.scheduleNextReverse();
      }, delay);
    }
    async renderCurrent() {
      if (this.index < 0 || this.index >= this.total)
        return;
      const msg = this.script.messages[this.index];
      await this.appendMessage(msg, this.index);
    }
    async appendMessage(msg, idx) {
      await this.onRender(msg, idx);
      this.maxIndex = Math.max(this.maxIndex, idx);
      this.onProgress(this.index + 1, this.total);
      scrollToBottom();
    }
  };
  var user_message_template = `<div class="relative space-y-2 space-x-2 demo-msg" data-role="user" data-idx="">
  <div class="flex flex-row-reverse w-full">
    <div class="menu-container">
      <img class="menu user" src="../img/user.svg" alt="User Avatar">
    </div>
    <div class="message"></div>
  </div>
</div>`;
  var system_message_template = `<div class="relative space-y-2 space-x-2 demo-msg" data-role="system" data-idx="">
  <div class="menu-container">
    <img class="menu system" src="" alt="System Avatar">
  </div>
  <div class="info hidden">
    <div class="info-header">Call information</div>
    <div class="info-content overflow-y-auto" data-content=""></div>
  </div>
  <div class="message" data-content=""></div>
  <div class="thinking">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>`;
  function scrollToBottom() {
    const topDiv = document.getElementById("top_div");
    if (topDiv) {
      requestAnimationFrame(() => {
        topDiv.scrollTo({ top: topDiv.scrollHeight, behavior: "smooth" });
      });
    }
  }
  async function renderMessage(msg, idx) {
    const messagesEl = document.getElementById("messages");
    if (!messagesEl)
      return;
    if (msg.role === "user") {
      const wrapper2 = document.createElement("div");
      wrapper2.innerHTML = user_message_template;
      const node2 = wrapper2.firstElementChild;
      node2.dataset.idx = String(idx);
      const messageDiv2 = node2.getElementsByClassName("message")[0];
      const textDiv = document.createElement("div");
      textDiv.className = "message-text";
      textDiv.innerText = msg.content;
      messageDiv2.appendChild(textDiv);
      messageDiv2.dataset.content = msg.content;
      messagesEl.appendChild(node2);
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.innerHTML = system_message_template;
    const node = wrapper.firstElementChild;
    node.dataset.idx = String(idx);
    node.dataset.role = msg.role;
    const menu = node.getElementsByClassName("menu")[0];
    menu.src = `../img/${msg.icon || (msg.role === "tool" ? "tool" : "agent")}.svg`;
    const messageDiv = node.getElementsByClassName("message")[0];
    const thinking = node.getElementsByClassName("thinking")[0];
    if (thinking)
      thinking.classList.remove("hidden");
    messagesEl.appendChild(node);
    const thinkMs = Math.min(600, 200 + msg.content.length / 20);
    await new Promise((r) => setTimeout(r, thinkMs));
    try {
      const html = await renderMarkdown(msg.content);
      messageDiv.innerHTML = html;
      messageDiv.dataset.content = msg.content;
    } catch (e) {
      messageDiv.innerText = msg.content;
    }
    if (msg.role === "tool" && msg.info) {
      const infoDiv = node.getElementsByClassName("info")[0];
      const infoContent = node.getElementsByClassName("info-content")[0];
      if (infoDiv && infoContent) {
        infoDiv.classList.remove("hidden");
        try {
          const infoHtml = await renderMarkdown(msg.info);
          infoContent.innerHTML = infoHtml;
        } catch (e) {
          infoContent.innerText = msg.info;
        }
      }
    }
    if (thinking)
      thinking.classList.add("hidden");
  }
  function setupConsole(player) {
    const progressBar = document.getElementById("progress-bar-inner");
    const progressTrack = document.getElementById("progress-track");
    player.onProgress = (current, total) => {
      const pct = total > 0 ? current / total * 100 : 0;
      if (progressBar)
        progressBar.style.width = pct + "%";
      const counter = document.getElementById("progress-counter");
      if (counter)
        counter.textContent = `${current} / ${total}`;
      const statCurrent = document.getElementById("stat-current");
      if (statCurrent)
        statCurrent.textContent = String(current);
      const statTotal = document.getElementById("stat-total");
      if (statTotal)
        statTotal.textContent = String(total);
    };
    let isDragging = false;
    function seekFromEvent(e) {
      if (!progressTrack)
        return;
      const rect = progressTrack.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const ratio = x / rect.width;
      const target = Math.floor(ratio * player.total);
      player.jumpTo(target);
    }
    progressTrack?.addEventListener("mousedown", (e) => {
      isDragging = true;
      seekFromEvent(e);
    });
    document.addEventListener("mousemove", (e) => {
      if (isDragging)
        seekFromEvent(e);
    });
    document.addEventListener("mouseup", () => {
      isDragging = false;
    });
    const btnPlay = document.getElementById("btn-play");
    const iconPlay = document.getElementById("icon-play");
    btnPlay?.addEventListener("click", () => {
      if (player.playing)
        player.pause();
      else
        player.play();
    });
    document.getElementById("btn-stop")?.addEventListener("click", () => player.stop());
    document.getElementById("btn-prev")?.addEventListener("click", () => player.prev());
    document.getElementById("btn-next")?.addEventListener("click", () => player.next());
    const intervalSlider = document.getElementById("interval-slider");
    const intervalValue = document.getElementById("interval-value");
    intervalSlider?.addEventListener("input", () => {
      const v = parseInt(intervalSlider.value, 10);
      player.setInterval(v);
      if (intervalValue)
        intervalValue.textContent = (v / 1e3).toFixed(1) + "s";
    });
    document.querySelectorAll(".speed-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = parseFloat(btn.dataset.speed || "1");
        player.setSpeed(s);
        document.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    document.querySelectorAll(".loop-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.loop;
        player.setLoopMode(mode);
        document.querySelectorAll(".loop-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const lbl = document.getElementById("loop-label");
        if (lbl) {
          lbl.textContent = mode === "loop" ? "\u5217\u8868\u5FAA\u73AF" : mode === "pingpong" ? "\u4E52\u4E53\u5FAA\u73AF" : "\u4E0D\u5FAA\u73AF";
        }
      });
    });
    player.onStateChange = () => {
      if (iconPlay)
        iconPlay.className = player.playing ? "fas fa-pause" : "fas fa-play";
      const title = document.getElementById("btn-play");
      if (title)
        title.setAttribute("title", player.playing ? "\u6682\u505C (Space)" : "\u64AD\u653E (Space)");
    };
    document.querySelectorAll(".script-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.script;
        const script = key === "tf" ? TF_NETWORK_SCRIPT : BUILT_IN_SCRIPT;
        player.setScript(script);
        const titleEl = document.getElementById("script-title");
        if (titleEl)
          titleEl.textContent = script.title;
        const scenarioEl = document.getElementById("script-scenario");
        if (scenarioEl)
          scenarioEl.textContent = script.scenario;
        document.querySelectorAll(".script-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        player.onProgress(0, script.messages.length);
      });
    });
  }
  function setupKeyboard(player) {
    document.addEventListener("keydown", (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA")
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (player.playing)
          player.pause();
        else
          player.play();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        player.prev();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        player.next();
      } else if (e.code === "Home") {
        e.preventDefault();
        player.jumpTo(0);
      } else if (e.code === "End") {
        e.preventDefault();
        player.jumpTo(player.total - 1);
      }
    });
  }
  function bootstrap() {
    const player = new DemoPlayer(BUILT_IN_SCRIPT);
    player.onRender = renderMessage;
    setupConsole(player);
    setupKeyboard(player);
    player.onProgress(0, player.total);
    window.demoPlayer = player;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
//# sourceMappingURL=renderer-demo.js.map
