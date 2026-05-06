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
    envs: document.getElementById("envs"),
    btn_save_envs: document.getElementById("btn_save_envs"),
    tasks: document.getElementById("tasks"),
    btn_save_tasks: document.getElementById("btn_save_tasks"),
    bgtasks: document.getElementById("bgtasks"),
    btn_clear_bgtasks: document.getElementById("btn_clear_bgtasks"),
    history_list: document.getElementById("history-list"),
    btn_new_chat: document.getElementById("new-chat"),
    renameDialog: document.getElementById("renameDialog"),
    renameInput: document.getElementById("renameInput"),
    model_select: document.getElementById("ai-model"),
    agentMode: document.getElementById("agentMode"),
    compress_box: document.getElementById("compress-context"),
    msg_count: document.getElementById("msg_count") || {
      innerText: "0"
    }
  };

  // main/state.ts
  var State = {
    uuid: null,
    chat: {},
    scroll_top: {
      info: true,
      data: true
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
  function createElement(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body.firstChild;
  }
  function getIcon(is_plugin) {
    return is_plugin ? "api" : "ai";
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
    }).catch((err) => {
      console.log("Copy failed", err);
    });
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
      if (fadeHint) {
        fadeHint.innerHTML = '<i class="fas fa-arrow-up"></i> Collapse';
      }
      if (collapseBtn) {
        collapseBtn.style.display = "flex";
        collapseBtn.title = "Collapse";
        collapseBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
      }
    } else {
      contentDiv?.classList.add("collapsed");
      container.setAttribute("data-collapsed", "true");
      if (fadeHint) {
        fadeHint.innerHTML = `<i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines`;
      }
      if (collapseBtn) {
        collapseBtn.style.display = "none";
      }
    }
  };
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
    const codeLines = token.text.split("\n");
    const lineCount = codeLines.length;
    const shouldCollapse = lineCount > 6;
    return `<div class="code-container" data-collapsed="${shouldCollapse ? "true" : "false"}">
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
  <div class="code-content${shouldCollapse ? " collapsed" : ""}">
    <pre class="hljs"><code>${token.text}</code></pre>
  </div>
  <div class="code-fade-overlay">
    <span class="code-fade-hint" onclick="toggleCodeCollapse(this, event)" data-line-count="${lineCount}">
      <i class="fas fa-arrow-down"></i> Expand all ${lineCount} lines
    </span>
  </div>
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

  // main/history.ts
  function setHistoryRunning(chatId) {
    const item = document.getElementById(chatId);
    if (item) {
      item.classList.remove("completed");
      item.classList.add("running");
    }
  }
  function setHistoryCompleted(chatId) {
    const item = document.getElementById(chatId);
    if (item) {
      item.classList.remove("running");
      item.classList.add("completed");
    }
  }

  // main/ui.ts
  function showLog(type, content) {
    window.electronAPI.showLog({ type, content });
  }

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
  async function toggleMessageGroup(group_id) {
    let elements = document.querySelectorAll(`[data-id="${group_id}"]`);
    elements.forEach(async function(message_element) {
      const deleteBtn = message_element.querySelector(".delete");
      if (message_element.classList.contains("message_del")) {
        let { del_mode } = await window.electronAPI.toggleMessageGroup({ group_id, del: false });
        if (del_mode) {
          message_element.remove();
        } else {
          message_element.classList.remove("message_del");
          if (deleteBtn) {
            deleteBtn.className = "far fa-trash-alt delete action-btn";
            deleteBtn.title = "delete";
          }
          message_element.querySelectorAll("[info_data-id]").forEach((element) => {
            if (element.classList.contains("del"))
              element.classList.remove("del");
            const chunkDeleteBtn = element.querySelector(".chunk-delete");
            if (chunkDeleteBtn) {
              chunkDeleteBtn.className = "far fa-trash-alt action-btn chunk-delete";
              chunkDeleteBtn.title = "delete";
            }
          });
          message_element.querySelectorAll("[chunk_data-id]").forEach((element) => {
            if (element.classList.contains("del"))
              element.classList.remove("del");
            const chunkDeleteBtn = element.querySelector(".chunk-delete");
            if (chunkDeleteBtn) {
              chunkDeleteBtn.className = "far fa-trash-alt action-btn chunk-delete";
              chunkDeleteBtn.title = "delete";
            }
          });
        }
      } else {
        let { del_mode } = await window.electronAPI.toggleMessageGroup({ group_id, del: true });
        if (del_mode) {
          message_element.remove();
        } else {
          message_element.classList.add("message_del");
          message_element.classList.add("message_toggle");
          if (deleteBtn) {
            deleteBtn.className = "fas fa-rotate-left delete action-btn";
            deleteBtn.title = "restore";
          }
          message_element.querySelectorAll("[info_data-id]").forEach((element) => {
            if (!element.classList.contains("del"))
              element.classList.add("del");
            const chunkDeleteBtn = element.querySelector(".chunk-delete");
            if (chunkDeleteBtn) {
              chunkDeleteBtn.className = "fas fa-rotate-left action-btn chunk-delete";
              chunkDeleteBtn.title = "restore";
            }
          });
          message_element.querySelectorAll("[chunk_data-id]").forEach((element) => {
            if (!element.classList.contains("del"))
              element.classList.add("del");
            const chunkDeleteBtn = element.querySelector(".chunk-delete");
            if (chunkDeleteBtn) {
              chunkDeleteBtn.className = "fas fa-rotate-left action-btn chunk-delete";
              chunkDeleteBtn.title = "restore";
            }
          });
        }
      }
    });
  }
  async function toggleContextMessage(context_id) {
    let { del_mode } = await window.electronAPI.toggleContextMessage(context_id);
    let elements = document.querySelectorAll(`[info_data-id="${context_id}"]`);
    elements.forEach(function(element) {
      if (del_mode)
        element.remove();
      else {
        element.classList.toggle("del");
        const deleteBtn = element.querySelector(".chunk-delete");
        if (deleteBtn) {
          if (element.classList.contains("del")) {
            deleteBtn.className = "fas fa-rotate-left action-btn chunk-delete";
            deleteBtn.title = "restore";
          } else {
            deleteBtn.className = "far fa-trash-alt action-btn chunk-delete";
            deleteBtn.title = "delete";
          }
        }
      }
    });
    elements = document.querySelectorAll(`[chunk_data-id="${context_id}"]`);
    elements.forEach(function(element) {
      if (del_mode)
        element.remove();
      else {
        element.classList.toggle("del");
        const deleteBtn = element.querySelector(".chunk-delete");
        if (deleteBtn) {
          if (element.classList.contains("del")) {
            deleteBtn.className = "fas fa-rotate-left action-btn chunk-delete";
            deleteBtn.title = "restore";
          } else {
            deleteBtn.className = "far fa-trash-alt action-btn chunk-delete";
            deleteBtn.title = "delete";
          }
        }
      }
    });
  }
  var compression_tasks = {};
  async function compressionGroupMessage(group_id) {
    let elements = document.querySelectorAll(`[data-id="${group_id}"]`);
    showLog("log", `Compressing message (id: ${group_id})...`);
    compression_tasks[group_id] = true;
    if (DOM.submit.classList.contains("running") == false) {
      DOM.submit.classList.add("running");
    }
    let { compression_content } = await window.electronAPI.compressionGroupMessage({ group_id });
    showLog("success", `Message compressed (id: ${group_id}).`);
    let keptUser = false;
    elements.forEach(async function(message_element) {
      if (!keptUser) {
        keptUser = true;
        let messageSystem = await formatMessage(system_message_template, {
          "icon": getIcon(false),
          "id": group_id,
          "message": compression_content
        }, "system");
        addRunning(messageSystem);
        const message_content = messageSystem.getElementsByClassName("message")[0];
        menuEvent(messageSystem, message_content, false);
        message_element.parentElement.insertBefore(messageSystem, message_element.nextSibling);
        delete compression_tasks[group_id];
        if (Object.keys(compression_tasks).length == 0) {
          DOM.submit.classList.remove("running");
        }
      } else {
        message_element.remove();
      }
    });
  }
  async function thumbMessageGroup(up, down, data) {
    let thumb = await window.electronAPI.thumbMessageGroup(data);
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
  function locateContextMessage(context_id) {
    let elements = document.querySelectorAll(`[info_data-id="${context_id}"]`);
    if (elements.length > 0)
      elements[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function quoteContextMessage(context_id) {
    const quotedContent = `Please invoke the memory_retrieval tool using context_id: ${context_id}`;
    DOM.input.value = quotedContent + "\n" + DOM.input.value;
  }
  function menuEvent(messageSystem, message_content, is_plugin) {
    const message_actions = messageSystem.getElementsByClassName("message-actions")[0];
    message_actions.classList.add("active");
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
      toggleMessageGroup(messageSystem.dataset.id);
    });
    toggle.addEventListener("click", () => {
      messageSystem.classList.toggle("message_toggle");
    });
    compression.addEventListener("click", () => {
      messageSystem.classList.toggle("message_compression");
      compressionGroupMessage(messageSystem.dataset.id);
    });
    thumbMessageGroup(thumbs_up, thumbs_down, { group_id: messageSystem.dataset.id, thumb: 0 });
    thumbs_up.addEventListener("click", () => {
      thumbMessageGroup(thumbs_up, thumbs_down, { group_id: messageSystem.dataset.id, thumb: 1 });
    });
    thumbs_down.addEventListener("click", () => {
      thumbMessageGroup(thumbs_up, thumbs_down, { group_id: messageSystem.dataset.id, thumb: -1 });
    });
  }
  async function enterEnd(messageSystem, chunk = null) {
    if (messageSystem) {
      const message_content = messageSystem.getElementsByClassName("message")[0];
      const thinking = messageSystem.getElementsByClassName("thinking")[0];
      thinking?.classList.add("hidden");
      if (messageSystem.dataset?.event_stop !== "true") {
        messageSystem.dataset.event_stop = "true";
        if (message_content)
          menuEvent(messageSystem, message_content.dataset.content, chunk?.is_plugin);
      }
    }
    DOM.submit.classList.remove("running");
  }
  function addRunning(messageSystem) {
    DOM.submit.classList.add("running");
    const message_actions = messageSystem.getElementsByClassName("message-actions")[0];
    message_actions.classList.remove("active");
  }
  function addThinking(messageSystem) {
    const thinking = messageSystem?.getElementsByClassName("thinking")[0];
    thinking.classList.remove("hidden");
    const btn = messageSystem?.getElementsByClassName("btn")[0];
    messageSystem.dataset.event_stop = "false";
    const groupId = messageSystem.dataset.id;
    if (groupId)
      setHistoryRunning(groupId);
    btn?.addEventListener("click", async () => {
      await window.electronAPI.stopMessage();
      enterEnd(messageSystem);
    });
  }
  async function userData(messages, data) {
    let messageUser;
    if (typeof data.content == "string") {
      messageUser = await formatMessage(user_message_template, {
        "id": data.group_id,
        "message": data.content,
        "image_url": data?.img_url
      }, "user");
    } else {
      messageUser = await formatMessage(user_message_template, {
        "id": data.group_id,
        "message": data.content[0].text.content,
        "image_url": data.content[1].image_url.url
      }, "user");
    }
    messages.appendChild(messageUser);
    let messageSystem = await formatMessage(system_message_template, {
      "icon": getIcon(false),
      "id": data.group_id,
      "message": ""
    }, "system");
    messages.appendChild(messageSystem);
    if (data?.del) {
      messageUser.classList.add("message_del");
      messageSystem.classList.add("message_del");
      messageUser.classList.add("message_toggle");
      messageSystem.classList.add("message_toggle");
      const updateDeleteBtn = (element) => {
        const deleteBtn = element.querySelector(".delete");
        if (deleteBtn) {
          deleteBtn.className = "fas fa-rotate-left delete action-btn";
          deleteBtn.title = "restore";
          deleteBtn.classList.add("active");
        }
      };
      updateDeleteBtn(messageUser);
      updateDeleteBtn(messageSystem);
    }
    return messageSystem;
  }
  async function infoData(info2) {
    const messageSystems = document.querySelectorAll(`[data-id='${info2.group_id}']`);
    const messageSystem = messageSystems[1];
    if (messageSystem) {
      const info_content = messageSystem.getElementsByClassName("info-content")[0];
      const info_div = messageSystem.getElementsByClassName("info")[0];
      if (info_div && info_div.classList.contains("hidden")) {
        info_div.classList.remove("hidden");
      }
      if (info2.content) {
        let info_item_content = await marked.parse(info2.content);
        let info_item = createElement(`<div info_data-id="${info2.context_id}">
    <div class="info-item">
    </div>
  </div>`);
        if (info2?.del)
          info_item.classList.add("del");
        info_item.getElementsByClassName("info-item")[0].innerHTML = info_item_content;
        info_content.appendChild(info_item);
        info_content.dataset.content = (info_content.dataset.content || "") + info2.content;
      }
      return info_content;
    }
  }
  async function toolData(chunk) {
    streamData(chunk);
  }
  async function streamData(chunk) {
    const messageSystems = document.querySelectorAll(`[data-id='${chunk.group_id}']`);
    const messageSystem = messageSystems[1];
    if (messageSystem) {
      const message_content = messageSystem.getElementsByClassName("message")[0];
      let context_id = Object.prototype.hasOwnProperty.call(chunk, "context_id") ? chunk.context_id : chunk.group_id;
      let chunk_content = null;
      let chunk_item_content = null;
      let chunk_reasoning_content = null;
      let chunk_item_reasoning_content = null;
      let chunk_item = null;
      let chunk_item_query = message_content.querySelectorAll(`[chunk_data-id='${context_id}']`);
      if (chunk?.content || chunk?.reasoning_content) {
        if (chunk_item_query.length > 0) {
          let existingItem = chunk_item_query[0];
          chunk_content = (existingItem.dataset.content || "") + chunk.content || "";
          chunk_item_content = await marked.parse(chunk_content);
          chunk_item = existingItem;
          chunk_item.dataset.content = chunk_content;
          chunk_item.getElementsByClassName("chunk-content")[0].innerHTML = chunk_item_content;
          if (chunk.reasoning_content) {
            chunk_item.getElementsByClassName("chunk-reasoning-content")[0].style.display = "block";
            chunk_reasoning_content = (existingItem.dataset.reasoning_content || "") + chunk.reasoning_content || "";
            chunk_item_reasoning_content = await marked.parse(chunk_reasoning_content);
            chunk_item.dataset.reasoning_content = chunk_reasoning_content;
            chunk_item.getElementsByClassName("chunk-reasoning-content")[0].innerHTML = chunk_item_reasoning_content;
          }
        } else {
          const deleteIcon = chunk?.del ? "fas fa-rotate-left" : "far fa-trash-alt";
          const deleteTitle = chunk?.del ? "restore" : "delete";
          chunk_item = createElement(`<div chunk_data-id="${context_id}">
          <div class="chunk">
            <div class="chunk-reasoning-content"></div>
            <div class="chunk-content"></div>
            <div class="chunk-actions">
              <i class="${deleteIcon} action-btn chunk-delete" title="${deleteTitle}"></i>
              <i class="fa fa-location-crosshairs action-btn chunk-location" title="location"></i>
              <i class="fa fa-quote-right action-btn chunk-quote" title="quote"></i>
            </div>
          </div>
        </div>`);
          if (chunk?.del)
            chunk_item.classList.add("del");
          chunk_content = chunk.content || "";
          chunk_item_content = await marked.parse(chunk_content);
          chunk_item.dataset.content = chunk_content;
          chunk_item.getElementsByClassName("chunk-content")[0].innerHTML = chunk_item_content;
          if (chunk.reasoning_content) {
            chunk_reasoning_content = chunk.reasoning_content || "";
            chunk_item_reasoning_content = await marked.parse(chunk_reasoning_content);
            chunk_item.dataset.reasoning_content = chunk_reasoning_content;
            chunk_item.getElementsByClassName("chunk-reasoning-content")[0].innerHTML = chunk_item_reasoning_content;
          } else {
            chunk_item.getElementsByClassName("chunk-reasoning-content")[0].style.display = "none";
          }
          if (!State.react_statu || chunk?.is_plugin) {
            chunk_item.getElementsByClassName("chunk-actions")[0].style.display = "none";
          }
          chunk_item.getElementsByClassName("chunk-delete")[0].addEventListener("click", () => {
            toggleContextMessage(context_id);
          });
          chunk_item.getElementsByClassName("chunk-location")[0].addEventListener("click", () => {
            locateContextMessage(context_id);
          });
          chunk_item.getElementsByClassName("chunk-quote")[0].addEventListener("click", () => {
            quoteContextMessage(context_id);
          });
          message_content.appendChild(chunk_item);
        }
        message_content.dataset.content = (message_content.dataset.content || "") + chunk.content || "";
        message_content.dataset.reasoning_content = (message_content.dataset.reasoning_content || "") + chunk.reasoning_content || "";
      }
      if (chunk.end) {
        enterEnd(messageSystem, chunk);
        if (chunk?.state !== "pause") {
          hidePauseOptions();
        }
      }
    }
    return messageSystem;
  }
  function hidePauseOptions() {
    DOM.pause.style.display = "none";
    DOM.pause.innerHTML = "";
  }
  window.electronAPI.setUUID((uuid) => State.uuid = uuid);
  window.electronAPI.agentRunning((data) => {
    if (data.group_id && data.uuid && State.uuid !== data.uuid)
      return;
    if (data?.id)
      setHistoryRunning(data.id);
    const messageSystems = document.querySelectorAll(`[data-id='${data.group_id}']`);
    const messageSystem = messageSystems[1];
    if (messageSystem) {
      addRunning(messageSystem);
      addThinking(messageSystem);
    }
  });
  window.electronAPI.agentIdle((data) => {
    if (data?.id)
      setHistoryCompleted(data.id);
    if (!data?.group_id)
      DOM.submit.classList.remove("running");
    if (data?.group_id && data.uuid && State.uuid !== data.uuid)
      return;
    const messageSystems = document.querySelectorAll(`[data-id='${data.group_id}']`);
    const messageSystem = messageSystems[1];
    if (messageSystem) {
      enterEnd(messageSystem);
    }
  });

  // main/subagent.ts
  var info = {
    id: null,
    name: null
  };
  var DOM2 = {
    messages: document.getElementById("messages"),
    infoName: document.getElementById("info-name"),
    minimizeBtn: document.getElementById("minimize-btn"),
    closeBtn: document.getElementById("close-btn"),
    top_div: document.getElementById("top_div")
  };
  document.addEventListener("DOMContentLoaded", () => {
    DOM2.top_div.addEventListener("mouseenter", () => {
      State.scroll_top.info = false;
      State.scroll_top.data = false;
    });
    DOM2.top_div.addEventListener("mouseleave", () => {
      State.scroll_top.info = true;
      State.scroll_top.data = true;
    });
  });
  window.electronAPI.streamData((chunk) => {
    streamData(chunk).then((_) => {
      if (State.scroll_top.data)
        DOM2.top_div.scrollTop = DOM2.top_div.scrollHeight;
    });
  });
  window.electronAPI.toolData((chunk) => {
    if (chunk.uuid && chunk.uuid !== State.uuid) {
      return;
    }
    toolData(chunk);
  });
  window.electronAPI.infoData((info2) => {
    if (info2.uuid && info2.uuid !== State.uuid) {
      return;
    }
    infoData(info2).then((info_content) => {
      if (State.scroll_top.info && info_content)
        info_content.scrollTop = info_content?.scrollHeight;
    });
  });
  window.electronAPI.userData((data) => {
    if (data.uuid && data.uuid !== State.uuid) {
      return;
    }
    userData(DOM2.messages, data).then((messageSystem) => {
      const thinking = messageSystem?.getElementsByClassName("thinking")[0];
      thinking.classList.remove("hidden");
      const btn = messageSystem?.getElementsByClassName("btn")[0];
      btn.remove();
      if (State.scroll_top.data)
        DOM2.top_div.scrollTop = DOM2.top_div.scrollHeight;
    });
  });
  window.electronAPI.windowInfo((data) => {
    info = data;
    DOM2.infoName.innerHTML = info.name;
  });
  DOM2.minimizeBtn.addEventListener("click", () => {
    window.electronAPI.minimizeWindow(info);
  });
  DOM2.closeBtn.addEventListener("click", () => {
    window.electronAPI.closeWindow(info);
  });
})();
//# sourceMappingURL=subagent.js.map
