"use strict";
(() => {
  // main/globals.ts
  var DOM = {
    system_prompt: document.getElementById("system_prompt"),
    file_upload: document.getElementById("file_upload"),
    act_plan: document.getElementById("act_plan"),
    auto: document.getElementById("auto"),
    act: document.getElementById("act"),
    plan: document.getElementById("plan"),
    flash: document.getElementById("flash"),
    pause: document.getElementById("pause"),
    progress_container: document.getElementById("progress-container"),
    progress_bar: document.getElementById("progress-bar"),
    input: document.getElementById("input"),
    submit: document.getElementById("submit"),
    messages: document.getElementById("messages"),
    top_div: document.getElementById("top_div"),
    bottom_div: document.getElementById("bottom_div"),
    version: document.getElementById("version"),
    tokens: document.getElementById("tokens"),
    seconds: document.getElementById("seconds"),
    auto_opt: document.getElementById("auto_opt"),
    envs: document.getElementById("envs"),
    btn_save_envs: document.getElementById("btn_save_envs"),
    tasks: document.getElementById("tasks"),
    btn_save_tasks: document.getElementById("btn_save_tasks"),
    history_list: document.getElementById("history-list"),
    btn_new_chat: document.getElementById("new-chat"),
    renameDialog: document.getElementById("renameDialog"),
    renameInput: document.getElementById("renameInput"),
    msg_count: document.getElementById("msg_count") || {
      innerText: "0"
    }
  };
  var State = {
    markdown_statu: true,
    seconds_timer: null,
    chat: { tokens: 0, seconds: 0, id: null, mode: "auto", system_prompt: "" },
    scroll_top: {
      info: true,
      data: true
    },
    status: {
      auto_opt: false
    },
    react_statu: false,
    formData: {
      query: null,
      prompt: null,
      file_path: null,
      img_url: null
    }
  };

  // main/utils.ts
  function getFileName(path) {
    return path.split("/").pop().split("\\").pop();
  }
  function getTokens(text) {
    const normalizedText = text.replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const chineseTokens = normalizedText.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g) || [];
    const wordTokens = normalizedText.match(/[a-zA-Z_][a-zA-Z0-9_]*|\+\+|--|&&|\|\||[<>!=]=?|\d+\.?\d*|[^\s\u4e00-\u9fa5]/g) || [];
    return chineseTokens.length + wordTokens.length;
  }
  function createElement(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body.firstChild;
  }
  function getIcon(is_plugin) {
    return is_plugin ? "api" : "ai";
  }

  // main/ui.ts
  function showLog(type, content) {
    window.electronAPI.showLog({ type, content });
  }
  function toggleMode(mode, send = true) {
    if (send)
      window.electronAPI.changeMode(mode);
    DOM.auto.classList.remove("active");
    DOM.act.classList.remove("active");
    DOM.plan.classList.remove("active");
    DOM.flash.classList.remove("active");
    switch (mode) {
      case "auto":
        DOM.auto.classList.add("active");
        break;
      case "act":
        DOM.act.classList.add("active");
        break;
      case "plan":
        DOM.plan.classList.add("active");
        break;
      case "flash":
        DOM.flash.classList.add("active");
        break;
    }
  }
  function autoResizeTextarea(textarea) {
    if (!textarea)
      return;
    textarea.style.height = "auto";
    const input_h = DOM.input ? DOM.input.clientHeight : 40;
    const minHeight = 40;
    const maxHeight = minHeight * 3;
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
    textarea.style.height = newHeight + "px";
    if (DOM.top_div && DOM.bottom_div) {
      DOM.top_div.style.height = window.innerHeight - DOM.bottom_div.clientHeight + "px";
    }
  }
  function init_size() {
    if (!DOM.input || !DOM.system_prompt || !DOM.top_div || !DOM.bottom_div)
      return;
    const bottomHeight = DOM.bottom_div.clientHeight;
    DOM.top_div.style.height = window.innerHeight - bottomHeight + "px";
  }
  function toggleSidebar() {
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
      sidebar.classList.toggle("collapsed");
      const icon = document.querySelector(".collapse-btn i");
      if (icon) {
        icon.classList.toggle("fa-chevron-left");
        icon.classList.toggle("fa-chevron-right");
      }
    }
  }
  var htmlContent = `
<div class="base-container">
    <div class="base-header">
      <div class="base-icon">B</div>
      <h1 class="base-title">I am TransMAgent, an AI agent specialized in transcriptional regulation analysis.</h1>
    </div>
    <div class="options-container">
      <div data-query="Coverage analysis of SNPs on the GATA2 gene" class="option-card">
        <div class="option-icon">\u{1F4CD}</div>
        <h3 class="option-title">Regional annotation analysis</h3>
        <p class="option-desc">Enhancer annotation, transcription factor binding prediction, SNP site analysis"</p>
      </div>
      <div data-query="Analyze TP53 gene expression across tissues and generate a heatmap visualization" class="option-card">
        <div class="option-icon">\u{1F4C8}</div>
        <h3 class="option-title">Gene expression analysis</h3>
        <p class="option-desc">Tissue/cell/disease-specific expression profiling, co-expression network analysis, and expression pattern visualization</p>
      </div>
      <div data-query="Analyze the enhancer coverage of ESR1, GATA3, FOXA1, and EP300 genes, and identify motifs in overlapping enhancers" class="option-card">
        <div class="option-icon">\u{1F9EC}</div>
        <h3 class="option-title">Sequence data analysis</h3>
        <p class="option-desc">Motif discovery, sequence alignment, deepTools analysis</p>
      </div>
    </div>
  </div>
`;
  function loadOptions() {
    DOM.messages.innerHTML = "";
    DOM.pause.style.display = "none";
    DOM.pause.innerHTML = "";
    State.chat.seconds = 0;
    if (State.seconds_timer)
      clearInterval(State.seconds_timer);
    State.chat.tokens = 0;
    DOM.tokens.innerText = "0";
    DOM.seconds.innerText = "0";
    const optionDom = createElement(htmlContent);
    const optionCards = optionDom.querySelectorAll(".option-card");
    optionCards.forEach((card) => {
      card.addEventListener("click", () => {
        const query = card.dataset.query;
        if (query) {
          State.formData.query = query;
          State.formData.prompt = DOM.system_prompt.value;
          window.electronAPI.clickSubmit(State.formData);
        }
      });
      card.style.cursor = "pointer";
      card.style.transition = "transform 0.2s";
      card.addEventListener("mouseenter", () => {
        card.style.transform = "scale(1.02)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "scale(1)";
      });
    });
    DOM.messages.append(optionDom);
  }
  function hideRenameDialog() {
    DOM.renameDialog.style.display = "none";
    DOM.renameInput.value = "";
  }
  function updateProgress(info) {
    switch (info.state) {
      case "start":
        DOM.progress_bar.style.width = `0%`;
        DOM.progress_bar.textContent = `0%`;
        DOM.progress_container.style.display = "block";
        break;
      case "progress":
        DOM.progress_bar.style.width = `${info.progress}%`;
        DOM.progress_bar.textContent = `${info.progress}%`;
        DOM.progress_container.style.display = "block";
        break;
      case "end":
        DOM.progress_bar.style.width = `100%`;
        DOM.progress_bar.textContent = `100%`;
        setTimeout(() => {
          DOM.progress_container.style.display = "none";
          if (info?.remotePath)
            DOM.input.value = `Upload: ${info.remotePath}
${DOM.input.value}`;
        }, 500);
        break;
      case "error":
        DOM.progress_bar.style.backgroundColor = "#ff4757";
        DOM.progress_bar.textContent = `\u4E0A\u4F20\u5931\u8D25: ${info.error}`;
        setTimeout(() => {
          DOM.progress_container.style.display = "none";
          DOM.progress_bar.style.backgroundColor = "";
        }, 3e3);
        break;
    }
  }

  // main/history.ts
  var new_item_template = `<div class="history-item" onclick="selectChat('@id')">
    <div class="history-text"></div>
    <div class="history-menu" onclick="showHistoryMenu(event, '@id')">
      <i class="fas fa-ellipsis-v"></i>
      <div class="history-menu-dropdown">
        <div class="history-menu-item" onclick="renameChat('@id')">
          <i class="fas fa-edit"></i> Rename
        </div>
        <div class="history-menu-item" onclick="deleteChat('@id')">
          <i class="fas fa-trash"></i> Delete
        </div>
      </div>
    </div>
  </div>`;
  function addChatItem(chat) {
    const item = createElement(new_item_template.replace(/@id/g, chat.id));
    item.getElementsByClassName("history-text")[0].innerText = chat.name || "New Chat";
    item.getElementsByClassName("history-text")[0].title = chat.name || "New Chat";
    item.id = chat.id;
    DOM.history_list.insertBefore(item, DOM.history_list.firstChild);
    item.onclick = () => selectChat(chat.id);
    const menu = item.querySelector(".history-menu");
    menu.onclick = (e) => showHistoryMenu(e, chat.id);
    const renameBtn = item.querySelector(".history-menu-item:nth-child(1)");
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renameChat(chat.id);
    };
    const deleteBtn = item.querySelector(".history-menu-item:nth-child(2)");
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    };
  }
  function newChat(chat) {
    addChatItem(chat);
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
      if (item.id == chat.id)
        item.classList.add("active");
      else
        item.classList.remove("active");
    });
  }
  async function selectChat(chatId) {
    const chat = await window.electronAPI.loadChat(chatId);
    State.chat = chat;
    toggleMode(State.chat.mode);
    DOM.system_prompt.value = State.chat.system_prompt;
    DOM.tokens.innerText = State.chat.tokens.toString();
    DOM.msg_count.innerText = State.chat.msg_count?.toString() || "0";
    DOM.seconds.innerText = State.chat.seconds.toFixed(1);
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
      if (item.id == chatId)
        item.classList.add("active");
      else
        item.classList.remove("active");
    });
  }
  async function deleteChat(chatId) {
    if (confirm("Are you sure you want to delete this conversation?")) {
      await window.electronAPI.delChat(chatId);
      const items = DOM.history_list.getElementsByClassName("history-item");
      Array.from(items).forEach((item) => {
        if (item.id == chatId)
          item.remove();
      });
    }
  }
  function showHistoryMenu(event, chatId) {
    event.stopPropagation();
    const menus = document.querySelectorAll(".history-menu-dropdown");
    menus.forEach((menu2) => menu2.style.display = "none");
    const target = event.currentTarget;
    const menu = target.querySelector(".history-menu-dropdown");
    menu.style.display = "block";
    State.chat.id = chatId;
  }
  function renameChat(chatId) {
    State.chat.id = chatId;
    DOM.renameDialog.style.display = "flex";
    DOM.renameInput.focus();
  }
  async function confirmRename() {
    const newName = DOM.renameInput.value.trim();
    if (newName && State.chat.id) {
      await window.electronAPI.renameChat({ id: State.chat.id, name: newName });
      const items = DOM.history_list.getElementsByClassName("history-item");
      Array.from(items).forEach((item) => {
        if (item.id == State.chat.id)
          item.getElementsByClassName("history-text")[0].innerText = newName;
      });
    }
    DOM.renameDialog.style.display = "none";
    DOM.renameInput.value = "";
  }

  // main/config.ts
  var editors = {
    envs: null,
    tasks: null
  };
  function initConfigEvents() {
    DOM.btn_save_envs.addEventListener("click", async () => {
      const envs = editors.envs.get();
      const statu = await window.electronAPI.Envs({ type: "set", envs });
      if (statu)
        showLog("success", "Configuration saved successfully!");
    });
    DOM.envs.addEventListener("click", async () => {
      const mEnvs = document.getElementById("m-envs");
      if (mEnvs)
        mEnvs.style.display = "flex";
      const config_envs = await window.electronAPI.Envs({ type: "get" });
      const editor_env = document.getElementById("editor_env");
      editors.envs = editors.envs || new JSONEditor(editor_env, {
        mode: "tree",
        modes: ["tree", "code"]
      });
      editors.envs.set(config_envs);
    });
    DOM.btn_save_tasks.addEventListener("click", async () => {
      const taskList = editors.tasks.get();
      const statu = await window.electronAPI.Tasks({ type: "set", tasks: taskList });
      if (statu)
        showLog("success", "Tasks saved!");
    });
    DOM.tasks.addEventListener("click", async () => {
      const taskList = await window.electronAPI.Tasks({ type: "get" });
      const mTasks = document.getElementById("m-tasks");
      if (mTasks)
        mTasks.style.display = "flex";
      const editor_tasks = document.getElementById("editor_tasks");
      editors.tasks = editors.tasks || new JSONEditor(editor_tasks, {
        mode: "tree",
        modes: ["tree", "code"]
      });
      editors.tasks.set(taskList);
    });
  }
  async function showConfig() {
    const mConfig = document.querySelector("#m-config");
    if (mConfig)
      mConfig.style.display = "flex";
    const config = await window.electronAPI.getConfig();
    const ai_model = document.getElementById("ai-model");
    const api_url = document.getElementById("api-url");
    const api_key = document.getElementById("api-key");
    ai_model.innerHTML = "";
    for (const model in config.models) {
      if (Object.prototype.hasOwnProperty.call(config.models[model], "api_key")) {
        if (!api_url.value && !api_key.value) {
          api_url.value = config.models[model]?.api_url || "";
          api_key.value = config.models[model]?.api_key || "";
        }
        const option = createElement(`<option value="${model}">${model}</option>`);
        ai_model.appendChild(option);
      }
    }
    ai_model.onchange = (event) => {
      api_url.value = config.models[event.target.value]?.api_url || "";
      api_key.value = config.models[event.target.value]?.api_key || "";
    };
    if (config.plugins?.cli_execute) {
      document.getElementById("cli-prompt").value = config.tool_call.cli_prompt || "";
      document.getElementById("ssh-host").value = config.tool_call.ssh_config?.host || "";
      document.getElementById("ssh-port").value = config.tool_call.ssh_config?.port || "";
      document.getElementById("ssh-username").value = config.tool_call.ssh_config?.username || "";
      document.getElementById("ssh-password").value = config.tool_call.ssh_config?.password || "";
      document.getElementById("ssh-enabled").checked = !!config.tool_call.ssh_config?.enabled;
      document.getElementById("mcp_server-biotools-url").value = config.mcp_server.biotools.url || "";
      document.getElementById("mcp_server-biotools-enabled").checked = !!config.mcp_server?.biotools.enabled;
    } else {
      const remoteDiv = document.getElementById("remote-div");
      if (remoteDiv)
        remoteDiv.style.display = "none";
    }
  }
  function hideConfig() {
    document.querySelectorAll(".config-modal").forEach((m) => m.style.display = "none");
  }
  async function saveConfig() {
    const config = await window.electronAPI.getConfig();
    const postConfig = {
      tool_call: {
        cli_prompt: document.getElementById("cli-prompt").value,
        ssh_config: {
          host: document.getElementById("ssh-host").value,
          port: parseInt(document.getElementById("ssh-port").value),
          username: document.getElementById("ssh-username").value,
          password: document.getElementById("ssh-password").value,
          enabled: document.getElementById("ssh-enabled").checked
        }
      },
      mcp_server: {
        biotools: {
          url: document.getElementById("mcp_server-biotools-url").value,
          disabled: document.getElementById("mcp_server-biotools-disabled").checked
        }
      }
    };
    let ai_config = {
      model: document.getElementById("ai-model").value,
      api_url: document.getElementById("api-url").value,
      api_key: document.getElementById("api-key").value
    };
    if (config.plugins?.cli_execute) {
      config.tool_call.ssh_config = postConfig.tool_call.ssh_config;
      config.tool_call.cli_prompt = postConfig.tool_call.cli_prompt;
      config.mcp_server.biotools.url = postConfig.mcp_server.biotools.url;
      config.mcp_server.biotools.disabled = postConfig.mcp_server.biotools.disabled;
    }
    config.models[ai_config.model].api_url = ai_config.api_url;
    config.models[ai_config.model].api_key = ai_config.api_key;
    await window.electronAPI.setConfig(config);
    showLog("success", "Configuration saved successfully!");
    hideConfig();
  }

  // main/markdown.ts
  var { Marked } = globalThis.marked;
  var { markedHighlight } = globalThis.markedHighlight;
  var totalTime = 0;
  var timerInterval = null;
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
        const pdfUrl = container.getAttribute("data-pdf");
        if (!pdfUrl)
          return;
        const canvas = container.querySelector("canvas");
        if (!canvas)
          return;
        const pdf = await globalThis.pdfjsLib.getDocument(pdfUrl).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const context = canvas.getContext("2d");
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
      } catch (error) {
        console.log("renderPDF error: ", error.message);
      }
    }, 500);
  }
  var formatCode = (token) => {
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
  var formatText = (token) => {
    let language = globalThis.hljs.getLanguage(token.type) ? token.type : "plaintext";
    const highlightResult = globalThis.hljs.highlight(token.raw, { language }).value;
    return highlightResult;
  };
  var formatImage = (token) => {
    if (token.title === "pdf") {
      return token.text;
    }
    return `<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${token.href}" alt="${token.text}"></img>`;
  };
  var formatLink = (token) => {
    const pattern = /^\[([^\]]+)\]\(([^)]+)\)$/;
    const match = token.raw.match(pattern);
    if (match) {
      const [, linkText, href] = match;
      return `<a href="${href}">${linkText}</a>`;
    }
    return token.text;
  };
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
  var walkTokens = async (token) => {
    if (token.type === "image") {
      try {
        if (token.href.endsWith(".pdf")) {
          const id = `pdf-canvas-${Date.now()}`;
          let containerHTML = `<div class="pdf-container" id="${id}" data-pdf="${token.href}">
            <canvas></canvas>
        </div>`;
          token.text = containerHTML;
          token.title = "pdf";
          renderPDF(id);
        }
      } catch {
        token.title = "invalid";
      }
    }
  };
  var thinkExtension = {
    name: "think",
    level: "block",
    start(src) {
      return src.match(/<think>/)?.index;
    },
    tokenizer(src) {
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
          text: match[1]
        };
      }
    }
  };
  function preprocess(src) {
    src = src.replace(/\\\(([^]+?)\\\)/g, (match, content) => `$${content}$`);
    src = src.replace(/\\\[([^]+?)\\\]/g, (match, content) => `
$$${content}$$
`);
    src = src.replace(/\$\$([^]+?)\$\$/g, (match, content) => `
$$
${content}
$$
`);
    return src;
  }
  var marked = new Marked(
    markedHighlight({
      async: true,
      langPrefix: "hljs language-",
      async highlight(code, lang) {
        if (lang === "mermaid") {
          const eleid = "mermaid-" + Date.now() + "-" + Math.round(Math.random() * 1e3);
          try {
            const syntax = await globalThis.mermaid.parse(code);
            if (syntax) {
              const { svg } = await globalThis.mermaid.render(eleid + "-svg", code);
              return `<div id="${eleid}">${svg}</div>`;
            }
          } catch {
            console.log("mermaid format validation failed");
          }
          return `<div id="${eleid}">${code}</div>`;
        }
        let language = globalThis.hljs.getLanguage(lang) ? lang : "plaintext";
        const hljsResult = await globalThis.hljs.highlight(code, { language });
        return hljsResult.value;
      }
    })
  );
  marked.use({ hooks: { preprocess } });
  marked.use(globalThis.markedKatex({ nonStandard: true, async: true }));
  marked.use({ walkTokens, renderer, async: true, extensions: [thinkExtension] });
  var initMermaid = () => {
    if (globalThis.mermaid) {
      globalThis.mermaid.initialize({ startOnLoad: false });
    }
  };

  // main/chat.ts
  var user_message_template = `<div class="relative space-y-2 space-x-2" data-role="user" data-id="">
  <div class="flex flex-row-reverse w-full">
    <div class="menu-container">
      <img class="menu user" src="img/user.svg" alt="User Avatar">
    </div>
    <div class="message"></div>
  </div>
</div>`;
  var system_message_template = `<div class="relative space-y-2 space-x-2" data-role="system" data-id="">
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
    <button class="btn">Stop generation</button>
  </div>
  <div class="message-actions">
    <i class="far fa-copy copy action-btn" title="copy"></i>
    <i class="far fa-trash-alt delete action-btn" title="delete"></i>
    <i class="fa-solid fa-file-zipper compression action-btn" title="compression"></i>
    <i class="fas fa-toggle-off toggle action-btn" title="toggle"></i>
    <i class="fas fa-thumbs-up thumbs-up action-btn" title="thumbs up"></i>
    <i class="fas fa-thumbs-down thumbs-down action-btn" title="thumbs down"></i>
  </div>
</div>`;
  async function formatMessage(template, params, role) {
    const newElement = createElement(template);
    let message = newElement.getElementsByClassName("message")[0];
    if (Object.prototype.hasOwnProperty.call(params, "icon")) {
      let menu = newElement.getElementsByClassName("menu")[0];
      menu.src = `img/${params["icon"]}.svg`;
    }
    if (role === "system") {
      message.innerHTML = await marked.parse(params["message"]);
    } else {
      if (params.image_url) {
        let img = createElement(`<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${params.image_url}">`);
        message.appendChild(img);
      }
      let text = createElement(`<div class="message-text"></div>`);
      text.innerText = params["message"] || "";
      message.appendChild(text);
    }
    newElement.dataset.id = params["id"];
    return newElement;
  }
  async function delete_message(id) {
    let elements = document.querySelectorAll(`[data-id="${id}"]`);
    elements.forEach(async function(message_element) {
      if (message_element.classList.contains("message_del")) {
        let { del_mode } = await window.electronAPI.toggleMessage({ id: parseInt(id), del: false });
        if (del_mode) {
          message_element.remove();
        } else {
          message_element.classList.remove("message_del");
          message_element.querySelectorAll("[info_data-id]").forEach((element) => {
            if (element.classList.contains("del"))
              element.classList.remove("del");
          });
          message_element.querySelectorAll("[chunk_data-id]").forEach((element) => {
            if (element.classList.contains("del"))
              element.classList.remove("del");
          });
        }
      } else {
        let { del_mode } = await window.electronAPI.toggleMessage({ id, del: true });
        if (del_mode) {
          message_element.remove();
        } else {
          message_element.classList.add("message_del");
          message_element.classList.add("message_toggle");
          message_element.querySelectorAll("[info_data-id]").forEach((element) => {
            if (!element.classList.contains("del"))
              element.classList.add("del");
          });
          message_element.querySelectorAll("[chunk_data-id]").forEach((element) => {
            if (!element.classList.contains("del"))
              element.classList.add("del");
          });
        }
      }
    });
  }
  var compression_tasks = {};
  async function compression_message(id) {
    let elements = document.querySelectorAll(`[data-id="${id}"]`);
    showLog("log", `Compressing message (id: ${id})...`);
    compression_tasks[id] = true;
    if (DOM.submit.classList.contains("running") == false) {
      DOM.submit.classList.add("running");
    }
    let { compression_content } = await window.electronAPI.compressionMessage({ id: parseInt(id) });
    showLog("success", `Message compressed (id: ${id}).`);
    let keptUser = false;
    elements.forEach(async function(message_element) {
      if (!keptUser) {
        keptUser = true;
        let messageSystem = await formatMessage(system_message_template, {
          "icon": getIcon(false),
          "id": id,
          "message": compression_content
        }, "system");
        addEventStop(messageSystem);
        const thinking = messageSystem.getElementsByClassName("thinking")[0];
        thinking.remove();
        const message_content = messageSystem.getElementsByClassName("message")[0];
        menuEvent(messageSystem, message_content, false);
        message_element.parentElement.insertBefore(messageSystem, message_element.nextSibling);
        delete compression_tasks[id];
        if (Object.keys(compression_tasks).length == 0) {
          DOM.submit.classList.remove("running");
        }
      } else {
        message_element.remove();
      }
    });
  }
  async function thumbMessage(up, down, data) {
    let thumb = await window.electronAPI.thumbMessage(data);
    if (thumb === 1) {
      if (!up.classList.contains("success"))
        up.classList.add("success");
      if (down.classList.contains("success"))
        down.classList.remove("success");
    } else if (thumb === -1) {
      if (!down.classList.contains("success"))
        down.classList.add("success");
      if (up.classList.contains("success"))
        up.classList.remove("success");
    } else {
      if (up.classList.contains("success"))
        up.classList.remove("success");
      if (down.classList.contains("success"))
        down.classList.remove("success");
    }
  }
  function locate_memory(context_id) {
    let elements = document.querySelectorAll(`[info_data-id="${context_id}"]`);
    if (elements.length > 0)
      elements[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function quote_memory(context_id) {
    const quotedContent = `Please invoke the memory_retrieval tool using context_id: ${context_id}`;
    DOM.input.value = quotedContent + "\n" + DOM.input.value;
  }
  async function delete_memory(context_id) {
    let { del_mode } = await window.electronAPI.toggleMemory(context_id);
    let elements = document.querySelectorAll(`[info_data-id="${context_id}"]`);
    elements.forEach(function(element) {
      if (del_mode)
        element.remove();
      else
        element.classList.toggle("del");
    });
    elements = document.querySelectorAll(`[chunk_data-id="${context_id}"]`);
    elements.forEach(function(element) {
      if (del_mode)
        element.remove();
      else
        element.classList.toggle("del");
    });
  }
  function menuEvent(messageSystem, message_content, is_plugin) {
    const copy = messageSystem.getElementsByClassName("copy")[0];
    const del = messageSystem.getElementsByClassName("delete")[0];
    const compression = messageSystem.getElementsByClassName("compression")[0];
    const toggle = messageSystem.getElementsByClassName("toggle")[0];
    const thumbs_up = messageSystem.getElementsByClassName("thumbs-up")[0];
    const thumbs_down = messageSystem.getElementsByClassName("thumbs-down")[0];
    copy.classList.add("active");
    del.classList.add("active");
    if (!is_plugin) {
      compression.classList.add("active");
      toggle.classList.add("active");
      thumbs_up.classList.add("active");
      thumbs_down.classList.add("active");
    }
    copy.addEventListener("click", () => {
      const raw = message_content.dataset.content || "";
      navigator.clipboard.writeText(raw).then(() => {
        showLog("success", "Copy successful");
      }).catch((err) => {
        console.log(err);
      });
    });
    del.addEventListener("click", () => {
      delete_message(messageSystem.dataset.id);
    });
    toggle.addEventListener("click", () => {
      messageSystem.classList.toggle("message_toggle");
    });
    compression.addEventListener("click", () => {
      messageSystem.classList.toggle("message_compression");
      compression_message(messageSystem.dataset.id);
    });
    thumbMessage(thumbs_up, thumbs_down, { id: messageSystem.dataset.id, thumb: 0 });
    thumbs_up.addEventListener("click", () => {
      thumbMessage(thumbs_up, thumbs_down, { id: messageSystem.dataset.id, thumb: 1 });
    });
    thumbs_down.addEventListener("click", () => {
      thumbMessage(thumbs_up, thumbs_down, { id: messageSystem.dataset.id, thumb: -1 });
    });
  }
  function addEventStop(messageSystem) {
    const message_content = messageSystem.getElementsByClassName("message")[0];
    const thinking = messageSystem?.getElementsByClassName("thinking")[0];
    const btn = messageSystem?.getElementsByClassName("btn")[0];
    btn?.addEventListener("click", async () => {
      await window.electronAPI.streamMessageStop();
      if (State.seconds_timer)
        clearInterval(State.seconds_timer);
      thinking?.remove();
      menuEvent(messageSystem, message_content.dataset.content, false);
      DOM.submit.classList.remove("running");
    });
    DOM.submit.classList.add("running");
  }
  async function userAdd(data) {
    let messageUser;
    if (typeof data.content == "string") {
      messageUser = await formatMessage(user_message_template, {
        "id": data.id,
        "message": data.content,
        "image_url": data?.img_url
      }, "user");
    } else {
      messageUser = await formatMessage(user_message_template, {
        "id": data.id,
        "message": data.content[0].text.content,
        "image_url": data.content[1].image_url.url
      }, "user");
    }
    DOM.messages.appendChild(messageUser);
    let messageSystem = await formatMessage(system_message_template, {
      "icon": getIcon(false),
      "id": data.id,
      "message": ""
    }, "system");
    DOM.messages.appendChild(messageSystem);
    addEventStop(messageSystem);
    if (data?.del) {
      messageUser.classList.add("message_del");
      messageSystem.classList.add("message_del");
      messageUser.classList.add("message_toggle");
      messageSystem.classList.add("message_toggle");
    }
  }
  async function infoAdd(info) {
    const messageSystems = document.querySelectorAll(`[data-id='${info.id}']`);
    const messageSystem = messageSystems[1];
    if (messageSystem) {
      const info_content = messageSystem.getElementsByClassName("info-content")[0];
      const info_div = messageSystem.getElementsByClassName("info")[0];
      if (info_div && info_div.classList.contains("hidden")) {
        info_div.classList.remove("hidden");
      }
      if (info.content) {
        if (State.seconds_timer) {
          State.chat.tokens += getTokens(info.content);
          DOM.tokens.innerText = State.chat.tokens.toString();
        }
        let info_item_content = await marked.parse(info.content);
        let info_item = createElement(`<div info_data-id="${info.context_id}">
    <div class="info-item">
    </div>
  </div>`);
        if (info?.del)
          info_item.classList.add("del");
        info_item.getElementsByClassName("info-item")[0].innerHTML = info_item_content;
        info_content.appendChild(info_item);
        info_content.dataset.content = (info_content.dataset.content || "") + info.content;
        if (State.scroll_top.info)
          info_content.scrollTop = info_content.scrollHeight;
        if (State.scroll_top.data)
          DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
      }
    }
  }
  async function streamMessageAdd(chunk) {
    const messageSystems = document.querySelectorAll(`[data-id='${chunk.id}']`);
    const messageSystem = messageSystems[1];
    if (messageSystem) {
      const message_content = messageSystem.getElementsByClassName("message")[0];
      if (chunk.content) {
        if (chunk.chat?.msg_count) {
          DOM.msg_count.innerText = chunk.chat.msg_count;
        }
        if (State.seconds_timer) {
          State.chat.tokens += getTokens(chunk.content);
          DOM.tokens.innerText = State.chat.tokens.toString();
        }
        const optionDom = document.querySelector(".base-container");
        if (optionDom)
          optionDom.remove();
        let context_id = Object.prototype.hasOwnProperty.call(chunk, "context_id") ? chunk.context_id : chunk.id;
        let chunk_content = null;
        let chunk_item_content = null;
        let chunk_item = null;
        let chunk_item_query = message_content.querySelectorAll(`[chunk_data-id='${context_id}']`);
        if (chunk_item_query.length > 0) {
          let existingItem = chunk_item_query[0];
          chunk_content = (existingItem.dataset.content || "") + chunk.content;
          chunk_item_content = await marked.parse(chunk_content);
          chunk_item = existingItem;
          chunk_item.dataset.content = chunk_content;
          chunk_item.getElementsByClassName("chunk-content")[0].innerHTML = chunk_item_content;
        } else {
          chunk_item = createElement(`<div chunk_data-id="${context_id}">
          <div class="chunk">
            <div class="chunk-content"></div>
            <div class="chunk-actions">
              <i class="far fa-trash-alt action-btn chunk-delete" title="delete"></i>
              <i class="fa fa-location-crosshairs action-btn chunk-location" title="location"></i>
              <i class="fa fa-quote-right action-btn chunk-quote" title="quote"></i>
            </div>
          </div>
        </div>`);
          if (chunk?.del)
            chunk_item.classList.add("del");
          chunk_content = chunk.content;
          chunk_item_content = await marked.parse(chunk_content);
          chunk_item.dataset.content = chunk.content;
          chunk_item.getElementsByClassName("chunk-content")[0].innerHTML = chunk_item_content;
          if (!State.react_statu || chunk?.is_plugin) {
            chunk_item.getElementsByClassName("chunk-actions")[0].style.display = "none";
          }
          chunk_item.getElementsByClassName("chunk-delete")[0].addEventListener("click", () => {
            delete_memory(context_id);
          });
          chunk_item.getElementsByClassName("chunk-location")[0].addEventListener("click", () => {
            locate_memory(context_id);
          });
          chunk_item.getElementsByClassName("chunk-quote")[0].addEventListener("click", () => {
            quote_memory(context_id);
          });
          message_content.appendChild(chunk_item);
        }
        message_content.dataset.content = (message_content.dataset.content || "") + chunk.content;
        if (State.scroll_top.data)
          DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
      }
      if (chunk.end) {
        if (State.seconds_timer) {
          clearInterval(State.seconds_timer);
          State.seconds_timer = null;
        }
        if (!messageSystem.dataset?.event_stop) {
          messageSystem.dataset.event_stop = "true";
          const thinking = messageSystem.getElementsByClassName("thinking")[0];
          if (thinking)
            thinking.remove();
          menuEvent(messageSystem, message_content, chunk?.is_plugin);
        }
        if (State.scroll_top.data)
          DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
        DOM.submit.classList.remove("running");
      }
      await window.electronAPI.setGlobal(State.chat);
    }
  }

  // main/main.ts
  document.addEventListener("DOMContentLoaded", () => {
    init_size();
    autoResizeTextarea(DOM.input);
    initMermaid();
    loadOptions();
    initConfigEvents();
    if (DOM.bottom_div && DOM.top_div) {
      const resizeObserver = new ResizeObserver(() => {
        DOM.top_div.style.height = window.innerHeight - DOM.bottom_div.clientHeight + "px";
      });
      resizeObserver.observe(DOM.bottom_div);
    }
    window.addEventListener("resize", () => init_size());
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".history-menu")) {
        document.querySelectorAll(".history-menu-dropdown").forEach((m) => m.style.display = "none");
      }
      if (!["input", "system_prompt"].includes(e.target.id)) {
        init_size();
      }
    });
    if (DOM.input) {
      const handleInput = (e) => {
        autoResizeTextarea(e.target);
        if (DOM.submit) {
          if (e.target.value.trim() !== "")
            DOM.submit.classList.add("success");
          else
            DOM.submit.classList.remove("success");
        }
      };
      DOM.input.addEventListener("input", handleInput);
      DOM.input.addEventListener("click", handleInput);
    }
    if (DOM.system_prompt) {
      const handleSysPrompt = () => autoResizeTextarea(DOM.system_prompt);
      DOM.system_prompt.addEventListener("input", handleSysPrompt);
      DOM.system_prompt.addEventListener("click", handleSysPrompt);
    }
    DOM.auto.addEventListener("click", () => toggleMode("auto"));
    DOM.act.addEventListener("click", () => toggleMode("act"));
    DOM.plan.addEventListener("click", () => toggleMode("plan"));
    DOM.flash.addEventListener("click", () => toggleMode("flash"));
    DOM.file_upload.addEventListener("click", async (e) => {
      State.formData.file_path = await window.electronAPI.getFilePath();
      e.target.innerText = State.formData.file_path ? getFileName(State.formData.file_path) : "Select file";
    });
    DOM.submit.addEventListener("click", async () => {
      if (DOM.submit.classList.contains("running")) {
        const messageSystemList = document.querySelectorAll('[data-role="system"]');
        if (messageSystemList.length > 0) {
          const messageSystem = messageSystemList[messageSystemList.length - 1];
          const btn = messageSystem.getElementsByClassName("btn")[0];
          btn?.click();
        }
      } else {
        State.formData.query = DOM.input.value;
        State.formData.prompt = DOM.system_prompt.value;
        window.electronAPI.clickSubmit(State.formData);
        DOM.pause.style.display = "none";
        DOM.pause.innerHTML = "";
      }
    });
    DOM.auto_opt.addEventListener("click", async (e) => {
      e.target.classList.toggle("active");
      await window.electronAPI.toggleAutoOpt();
    });
    const collapseBtn = document.querySelector(".collapse-btn");
    if (collapseBtn)
      collapseBtn.addEventListener("click", toggleSidebar);
    const configBtn = document.querySelector(".config-btn");
    if (configBtn)
      configBtn.addEventListener("click", showConfig);
    DOM.btn_new_chat.addEventListener("click", async () => {
      const chat = await window.electronAPI.newChat();
      newChat(chat);
    });
    const confirmRenameBtn = document.getElementById("confirmRename");
    if (confirmRenameBtn)
      confirmRenameBtn.addEventListener("click", confirmRename);
    const cancelRenameBtn = document.getElementById("cancelRename");
    if (cancelRenameBtn)
      cancelRenameBtn.addEventListener("click", hideRenameDialog);
    const saveConfigBtn = document.getElementById("save-config");
    if (saveConfigBtn)
      saveConfigBtn.addEventListener("click", saveConfig);
    const cancelConfigBtn = document.getElementById("cancel-config");
    if (cancelConfigBtn)
      cancelConfigBtn.addEventListener("click", hideConfig);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape")
        hideConfig();
    });
  });
  window.electronAPI.handleLog((log) => showLog(log.type, log.content));
  window.electronAPI.handleDeleteMemory(({ context_ids, ids }) => {
    let elements = document.querySelectorAll(`[info_data-id]`);
    elements.forEach((element) => {
      if (context_ids.includes(parseInt(element.getAttribute("info_data-id")))) {
        if (!element.classList.contains("del"))
          element.classList.add("del");
      } else if (element.classList.contains("del")) {
        element.classList.remove("del");
      }
    });
    elements = document.querySelectorAll(`[chunk_data-id]`);
    elements.forEach((element) => {
      if (context_ids.includes(parseInt(element.getAttribute("chunk_data-id")))) {
        if (!element.classList.contains("del"))
          element.classList.add("del");
      } else if (element.classList.contains("del")) {
        element.classList.remove("del");
      }
    });
    elements = document.querySelectorAll(`[data-id]`);
    elements.forEach((element) => {
      if (ids.includes(parseInt(element.getAttribute("data-id")))) {
        if (!element.classList.contains("message_del"))
          element.classList.add("message_del");
      } else if (element.classList.contains("message_del")) {
        element.classList.remove("message_del");
      }
    });
  });
  window.electronAPI.initInfo((info) => {
    toggleMode(info.chat.mode);
    DOM.system_prompt.value = info.chat.system_prompt;
    DOM.version.innerText = info.version;
    DOM.history_list.innerHTML = "";
    info.chats.forEach((chat) => addChatItem(chat));
    if (State.seconds_timer)
      clearInterval(State.seconds_timer);
    State.seconds_timer = null;
    State.chat = info.chat;
    DOM.tokens.innerText = State.chat.tokens.toString();
    DOM.seconds.innerText = State.chat.seconds.toString();
    State.status = info.status;
    if (State.status.auto_opt)
      DOM.auto_opt.classList.add("active");
    else
      DOM.auto_opt.classList.remove("active");
  });
  window.electronAPI.handleChangeMode((mode) => toggleMode(mode, false));
  window.electronAPI.handleMarkDownFormat((status) => State.markdown_statu = status);
  window.electronAPI.handleReactStatu((status) => State.react_statu = status);
  window.electronAPI.streamData((chunk) => streamMessageAdd(chunk));
  window.electronAPI.infoData((info) => infoAdd(info));
  window.electronAPI.userData((data) => userAdd(data));
  window.electronAPI.handleQuery(async ({ data, api_callback = true }) => {
    DOM.pause.style.display = "none";
    DOM.pause.innerHTML = "";
    const optionDom = document.querySelector(".base-container");
    if (optionDom)
      optionDom.remove();
    if (State.seconds_timer)
      clearInterval(State.seconds_timer);
    State.seconds_timer = setInterval(() => {
      State.chat.seconds += 0.1;
      DOM.seconds.innerText = State.chat.seconds.toFixed(1);
    }, 100);
    DOM.tokens.innerText = State.chat.tokens.toString();
    DOM.version.innerText = data.version;
    data.prompt = DOM.system_prompt.value;
    let user_content = data.img_url ? DOM.input.value : data.query;
    await userAdd({
      id: data.id,
      content: user_content,
      img_url: data.img_url
    });
    DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
    if (api_callback)
      window.electronAPI.queryText(data);
  });
  window.electronAPI.handleExtraLoad((data) => {
    DOM.system_prompt.style.display = "none";
    DOM.file_upload.style.display = "none";
    DOM.act_plan.style.display = "none";
    data?.forEach((item) => {
      switch (item.type) {
        case "system-prompt":
          DOM.system_prompt.style.display = "block";
          break;
        case "file-upload":
          DOM.file_upload.style.display = "flex";
          break;
        case "act-plan":
          DOM.act_plan.style.display = "flex";
          break;
      }
    });
    init_size();
  });
  window.electronAPI.handleOptions(({ options, id }) => {
    DOM.pause.style.display = "flex";
    let option_querys = [];
    options.forEach((value) => {
      const option = document.createElement("div");
      option.className = "btn";
      option.dataset.id = id;
      option.innerText = value;
      option.addEventListener("click", function() {
        if (this.classList.contains("active")) {
          this.classList.remove("active");
          option_querys = option_querys.filter((item) => item !== value);
          return;
        }
        this.classList.add("active");
        option_querys.push(value);
      });
      DOM.pause.appendChild(option);
    });
    const send = document.createElement("div");
    send.className = "btn success";
    send.dataset.id = id;
    send.innerText = "Send";
    send.addEventListener("click", async function() {
      State.formData.query = option_querys.join("\n");
      State.formData.prompt = DOM.system_prompt.value;
      window.electronAPI.clickSubmit(State.formData);
      option_querys = [];
      DOM.pause.style.display = "none";
      DOM.pause.innerHTML = "";
    });
    DOM.pause.appendChild(send);
    if (State.scroll_top.data)
      DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
  });
  window.electronAPI.setPrompt((prompt) => DOM.system_prompt.value = prompt);
  window.electronAPI.handleClear(() => loadOptions());
  window.electronAPI.uploadProgress((info) => updateProgress(info));
  window.electronAPI.handleNewChat((chat) => newChat(chat));
  window.electronAPI.handleSelectChat((chat) => selectChat(chat.id));
  window.electronAPI.handleSetChat(async (chat) => {
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
      if (item.id == State.chat.id)
        item.getElementsByClassName("history-text")[0].innerText = chat.name;
    });
    State.chat = chat;
    toggleMode(State.chat.mode);
    DOM.system_prompt.value = State.chat.system_prompt;
    DOM.tokens.innerText = State.chat.tokens.toString();
    DOM.msg_count.innerText = State.chat.msg_count?.toString() || "0";
    DOM.seconds.innerText = State.chat.seconds.toFixed(1);
  });
  window.electronAPI.handleAutoRenameChat(async (chat) => {
    State.chat.id = chat.id;
    await window.electronAPI.renameChat({ id: State.chat.id, name: chat.name });
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
      if (item.id == State.chat.id)
        item.getElementsByClassName("history-text")[0].innerText = chat.name;
    });
  });
  window.hideConfig = hideConfig;
  window.saveConfig = saveConfig;
  window.showConfig = showConfig;
  window.confirmRename = confirmRename;
  window.hideRenameDialog = hideRenameDialog;
  window.selectChat = selectChat;
  window.renameChat = renameChat;
  window.deleteChat = deleteChat;
  window.showHistoryMenu = showHistoryMenu;
})();
//# sourceMappingURL=renderer.js.map
