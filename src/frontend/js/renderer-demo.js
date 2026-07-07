"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => {
    __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    return value;
  };

  // demo/data.ts
  var EMPTY_SCRIPT = {
    title: "",
    scenario: "",
    totalDurationHint: "",
    messages: []
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
      if (this.total === 0) {
        console.warn("[demo] no messages to play");
        return;
      }
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
      if (this.total === 0)
        return;
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
  var timeline_message_template = `<div class="demo-msg" data-role="system" data-idx="">
  <div class="timeline-rail" aria-hidden="true">
    <div class="timeline-line"></div>
    <div class="timeline-dot"></div>
  </div>
  <div class="msg-shell">
    <div class="msg-avatar"></div>
    <div class="msg-card">
      <div class="msg-meta">
        <div class="msg-meta-left">
          <span class="role-badge"></span>
          <span class="msg-index"></span>
        </div>
        <span class="msg-caption"></span>
      </div>
      <div class="info hidden">
        <div class="info-header">Call information</div>
        <div class="info-content" data-content=""></div>
      </div>
      <div class="bubble message" data-content=""></div>
      <div class="thinking">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  </div>
</div>`;
  function renderEmptyState(reason) {
    const messagesEl = document.getElementById("messages");
    if (!messagesEl)
      return;
    const titleEl = document.getElementById("script-title");
    const scenarioEl = document.getElementById("script-scenario");
    const cfg = {
      "no-history": {
        title: "\u5F53\u524D\u65E0\u4F1A\u8BDD\u5386\u53F2",
        scenario: "\u8BF7\u5148\u5728\u4E3B\u7A97\u53E3\u53D1\u8D77\u5BF9\u8BDD,\u6F14\u793A\u7A97\u53E3\u5C06\u81EA\u52A8\u52A0\u8F7D\u60A8\u7684\u771F\u5B9E\u804A\u5929\u8BB0\u5F55",
        hint: "\u{1F4A1} \u5728\u4E3B\u7A97\u53E3\u8F93\u5165\u6D88\u606F\u540E,\u518D\u6B21\u70B9\u51FB\u6F14\u793A\u6309\u94AE\u5373\u53EF\u52A0\u8F7D\u4F1A\u8BDD\u5386\u53F2"
      },
      "timeout": {
        title: "\u672A\u63A5\u6536\u5230\u4F1A\u8BDD\u6570\u636E",
        scenario: "5 \u79D2\u5185\u4E3B\u7A97\u53E3\u672A\u63A8\u9001\u6709\u6548 payload (\u53EF\u80FD\u4E3B\u7A97\u53E3\u804A\u5929\u5386\u53F2\u4E3A\u7A7A)",
        hint: "\u{1F4A1} \u8BF7\u786E\u8BA4\u4E3B\u7A97\u53E3\u5B58\u5728\u804A\u5929\u8BB0\u5F55,\u7136\u540E\u91CD\u65B0\u6253\u5F00\u6F14\u793A\u7A97\u53E3"
      },
      "error": {
        title: "\u6570\u636E\u52A0\u8F7D\u5931\u8D25",
        scenario: "\u89E3\u6790\u540E\u7AEF payload \u65F6\u51FA\u9519,\u5DF2\u505C\u6B62\u64AD\u653E",
        hint: "\u{1F4A1} \u8BF7\u67E5\u770B\u4E3B\u8FDB\u7A0B\u65E5\u5FD7\u6216\u91CD\u65B0\u6253\u5F00\u6F14\u793A\u7A97\u53E3"
      }
    };
    const c = cfg[reason];
    if (titleEl)
      titleEl.textContent = c.title;
    if (scenarioEl)
      scenarioEl.textContent = c.scenario;
    messagesEl.innerHTML = `
    <div class="demo-empty-state">
      <div class="demo-empty-icon">
        <i class="fas fa-comments"></i>
      </div>
      <div class="demo-empty-title">${c.title}</div>
      <div class="demo-empty-scenario">${c.scenario}</div>
      <div class="demo-empty-hint">${c.hint}</div>
    </div>
  `;
  }
  function scrollToBottom() {
    const topDiv = document.getElementById("top_div");
    if (topDiv) {
      requestAnimationFrame(() => {
        topDiv.scrollTo({ top: topDiv.scrollHeight, behavior: "smooth" });
      });
    }
  }
  function getRoleMeta(msg) {
    if (msg.role === "user") {
      return {
        badge: "\u7528\u6237\u8F93\u5165",
        caption: "\u9700\u6C42 / \u6307\u4EE4",
        avatar: "U"
      };
    }
    if (msg.role === "tool") {
      return {
        badge: "\u5DE5\u5177\u8F93\u51FA",
        caption: "\u6267\u884C\u7ED3\u679C",
        avatar: "T"
      };
    }
    return {
      badge: "\u7CFB\u7EDF\u54CD\u5E94",
      caption: "\u5206\u6790 / \u89E3\u91CA",
      avatar: "A"
    };
  }
  async function renderMessage(msg, idx) {
    const messagesEl = document.getElementById("messages");
    if (!messagesEl)
      return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = timeline_message_template;
    const node = wrapper.firstElementChild;
    node.dataset.idx = String(idx);
    node.dataset.role = msg.role;
    const meta = getRoleMeta(msg);
    const avatar = node.getElementsByClassName("msg-avatar")[0];
    const badge = node.getElementsByClassName("role-badge")[0];
    const caption = node.getElementsByClassName("msg-caption")[0];
    const msgIndex = node.getElementsByClassName("msg-index")[0];
    const bubble = node.getElementsByClassName("bubble")[0];
    const thinking = node.getElementsByClassName("thinking")[0];
    const rail = node.getElementsByClassName("timeline-rail")[0];
    if (avatar)
      avatar.textContent = meta.avatar;
    if (badge)
      badge.textContent = meta.badge;
    if (caption)
      caption.textContent = meta.caption;
    if (msgIndex)
      msgIndex.textContent = `#${String(idx + 1).padStart(2, "0")}`;
    if (idx === 0 && rail)
      rail.classList.add("is-first");
    if (msg.role === "user") {
      if (thinking)
        thinking.classList.add("hidden");
      bubble.textContent = msg.content;
      bubble.dataset.content = msg.content;
      messagesEl.appendChild(node);
      return;
    }
    if (thinking)
      thinking.classList.remove("hidden");
    messagesEl.appendChild(node);
    const thinkMs = Math.min(600, 200 + msg.content.length / 20);
    await new Promise((r) => setTimeout(r, thinkMs));
    try {
      const html = await renderMarkdown(msg.content);
      bubble.innerHTML = html;
      bubble.dataset.content = msg.content;
    } catch (e) {
      bubble.innerText = msg.content;
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
    const empty = document.querySelector(".demo-empty");
    if (empty && empty.parentElement === document.getElementById("messages")) {
      empty.remove();
    }
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
      if (player.total === 0) {
        console.warn("[demo] no messages, cannot play");
        return;
      }
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
      btn.style.opacity = "0.4";
      btn.style.cursor = "not-allowed";
      btn.title = "\u5B9E\u65F6\u4F1A\u8BDD\u6A21\u5F0F:\u811A\u672C\u4E0D\u53EF\u5207\u6362";
      btn.classList.remove("active");
    });
  }
  function setupKeyboard(player) {
    document.addEventListener("keydown", (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA")
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (player.total === 0)
          return;
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
  function buildLiveScript(payload) {
    const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
    return {
      title: typeof payload?.title === "string" ? payload.title : "\u5F53\u524D\u4F1A\u8BDD\u56DE\u653E",
      scenario: typeof payload?.scenario === "string" ? payload.scenario : `${msgs.length} \u6761\u6D88\u606F \xB7 \u9ED8\u8BA4\u95F4\u9694 2s`,
      totalDurationHint: "",
      messages: msgs.map((m) => ({
        role: m.role === "user" || m.role === "tool" ? m.role : "system",
        content: typeof m.content === "string" ? m.content : "",
        info: typeof m.info === "string" ? m.info : void 0
      }))
    };
  }
  function applyLivePayload(player, payload, titleEl, scenarioEl) {
    try {
      if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
        console.warn("[demo] live payload empty/invalid");
        return false;
      }
      const live = buildLiveScript(payload);
      player.setScript(live);
      if (titleEl)
        titleEl.textContent = live.title;
      if (scenarioEl)
        scenarioEl.textContent = live.scenario;
      console.log("[demo] live history applied:", live.messages.length, "messages");
      return true;
    } catch (err) {
      console.error("[demo] failed to apply live payload:", err);
      return false;
    }
  }
  function bootstrap() {
    const initialScript = EMPTY_SCRIPT;
    const player = new DemoPlayer(initialScript);
    player.onRender = renderMessage;
    setupConsole(player);
    setupKeyboard(player);
    const titleEl = document.getElementById("script-title");
    if (titleEl)
      titleEl.textContent = initialScript.title;
    const scenarioEl = document.getElementById("script-scenario");
    if (scenarioEl)
      scenarioEl.textContent = initialScript.scenario;
    player.onProgress(0, player.total);
    window.demoPlayer = player;
    let applied = false;
    const bootPayload = window.__DEMO_PAYLOAD__;
    if (bootPayload && Array.isArray(bootPayload.messages) && bootPayload.messages.length > 0) {
      applied = applyLivePayload(player, bootPayload, titleEl, scenarioEl);
    } else {
      renderEmptyState("no-history");
    }
    if (window.demoAPI && typeof window.demoAPI.onDemoData === "function") {
      window.demoAPI.onDemoData((payload) => {
        const ok = applyLivePayload(player, payload, titleEl, scenarioEl);
        if (ok)
          applied = true;
      });
      if (typeof window.demoAPI.notifyReady === "function") {
        window.demoAPI.notifyReady();
      }
    }
    if (!applied) {
      let polls = 0;
      const poll = window.setInterval(() => {
        polls++;
        const p = window.__DEMO_PAYLOAD__;
        if (p && Array.isArray(p.messages) && p.messages.length > 0) {
          window.clearInterval(poll);
          console.log("[demo] __DEMO_PAYLOAD__ arrived after", polls * 200, "ms");
          applyLivePayload(player, p, titleEl, scenarioEl);
        } else if (polls >= 25) {
          window.clearInterval(poll);
          console.warn("[demo] __DEMO_PAYLOAD__ timeout after 5s, showing empty state");
          if (!applied)
            renderEmptyState("timeout");
        }
      }, 200);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
//# sourceMappingURL=renderer-demo.js.map
