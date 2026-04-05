import { DOM } from './globals';
import { State, ChatState } from './state';
import { init_size, autoResizeTextarea, handleClear, showLog, toggleMode, toggleSidebar, updateProgress, hideRenameDialog } from './ui';
import { addChatItem, handleNewChat, selectChat, deleteChat, renameChat, confirmRename, showHistoryMenu, initChat, updateChat } from './history';
import { initConfigEvents, showConfig, saveConfig, hideConfig } from './config';
import { userData, infoData, streamData, startAgentLoop, addRunning, toolData, enterEnd } from './chat';
import { initMermaid } from './markdown';
import { getFileName } from './utils';

// --- Event Listeners & Initialization ---

document.addEventListener("DOMContentLoaded", () => {
  init_size();
  autoResizeTextarea(DOM.input);
  initMermaid();
  handleClear();
  initConfigEvents();

  // Resize Observer
  if (DOM.bottom_div && DOM.top_div) {
    const resizeObserver = new ResizeObserver(() => {
      DOM.top_div.style.height = (window.innerHeight - DOM.bottom_div.clientHeight) + "px";
    });
    resizeObserver.observe(DOM.bottom_div);
  }

  // Window Resize
  window.addEventListener("resize", () => init_size());

  // Scroll Top
  DOM.top_div.addEventListener("mouseenter", () => {
    State.scroll_top.info = false;
    State.scroll_top.data = false;
  });
  DOM.top_div.addEventListener("mouseleave", () => {
    State.scroll_top.info = true;
    State.scroll_top.data = true;
  });

  // Global Click (Close Menus)
  document.addEventListener('click', (e: any) => {
    if (!e.target.closest('.history-menu')) {
      document.querySelectorAll('.history-menu-dropdown').forEach((m: any) => m.style.display = 'none');
    }
    if (!["input", "system_prompt"].includes(e.target.id)) {
      init_size();
    }
  });

  // Input Events
  if (DOM.input) {
    const handleInput = (e: any) => {
      autoResizeTextarea(e.target);
      if (DOM.submit) {
        if (e.target.value.trim() !== '') DOM.submit.classList.add('success');
        else DOM.submit.classList.remove('success');
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

  // Mode Toggles
  DOM.auto.addEventListener("click", () => toggleMode("auto", true));
  DOM.act.addEventListener("click", () => toggleMode("act", true));
  DOM.plan.addEventListener("click", () => toggleMode("plan", true));
  DOM.flash.addEventListener("click", () => toggleMode("flash", true));

  // File Upload
  DOM.file_upload.addEventListener("click", async (e: any) => {
    State.formData.file_path = await window.electronAPI.getFilePath();
    e.target.innerText = State.formData.file_path ? getFileName(State.formData.file_path) : "Select file";
  });

  // Submit
  DOM.submit.addEventListener("click", async () => {
    if (DOM.submit.classList.contains("running")) {
      const messageSystemList = document.querySelectorAll('[data-role="system"]');
      if (messageSystemList.length > 0) {
        const messageSystem = messageSystemList[messageSystemList.length - 1];
        const btn = messageSystem.getElementsByClassName("btn")[0] as HTMLElement;
        btn?.click();
      }
    } else {
      State.formData.query = DOM.input.value;
      State.formData.prompt = DOM.system_prompt.value;
      startAgentLoop(State.formData);
      window.electronAPI.agentLoop(State.formData);
    }
  });

  // Sidebar & Config Buttons
  const collapseBtn = document.querySelector('.nav-collapse-btn');
  if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebar);

  const configBtn = document.querySelector('.config-btn');
  if (configBtn) configBtn.addEventListener('click', showConfig);

  DOM.btn_new_chat.addEventListener("click", async () => {
    const chat = await window.electronAPI.newChat();
    handleNewChat(chat);
  });

  // Rename Dialog
  const confirmRenameBtn = document.getElementById('confirmRename');
  if (confirmRenameBtn) confirmRenameBtn.addEventListener('click', confirmRename);
  const cancelRenameBtn = document.getElementById('cancelRename');
  if (cancelRenameBtn) cancelRenameBtn.addEventListener('click', hideRenameDialog);

  // Config Modal
  const saveConfigBtn = document.getElementById('save-config');
  if (saveConfigBtn) saveConfigBtn.addEventListener('click', saveConfig);
  const cancelConfigBtn = document.getElementById('cancel-config');
  if (cancelConfigBtn) cancelConfigBtn.addEventListener('click', hideConfig);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideConfig();
  });
});

// --- Electron API Handlers ---

window.electronAPI.handleLog((log) => showLog(log.type, log.content));

window.electronAPI.handleDeleteMemory(({ context_ids, ids }) => {
  let elements = document.querySelectorAll(`[info_data-id]`);
  elements.forEach((element: any) => {
    if (context_ids.includes(parseInt(element.getAttribute('info_data-id')))) {
      if (!element.classList.contains('del')) element.classList.add('del');
    } else if (element.classList.contains('del')) {
      element.classList.remove('del');
    }
  });
  elements = document.querySelectorAll(`[chunk_data-id]`);
  elements.forEach((element: any) => {
    if (context_ids.includes(parseInt(element.getAttribute('chunk_data-id')))) {
      if (!element.classList.contains('del')) element.classList.add('del');
    } else if (element.classList.contains('del')) {
      element.classList.remove('del');
    }
  });
  elements = document.querySelectorAll(`[data-id]`);
  elements.forEach((element: any) => {
    if (ids.includes(parseInt(element.getAttribute('data-id')))) {
      if (!element.classList.contains('message_del')) element.classList.add('message_del');
    } else if (element.classList.contains('message_del')) {
      element.classList.remove('message_del');
    }
  });
});

window.electronAPI.initInfo((data) => {
  initChat(data as ChatState);
  DOM.history_list.innerHTML = ""; // Clear list before adding
  data.chats.forEach((chat: any) => addChatItem(chat));
});

window.electronAPI.handleMarkDownFormat((status) => State.markdown_statu = status);

window.electronAPI.handleReactStatu((status) => State.react_statu = status);

window.electronAPI.streamData((data) => {
  if (data.uuid && data.uuid !== State.uuid) {
    return;
  }
  updateChat(data as ChatState);
  if (data?.id !== State.chat.id) {
    return;
  }
  if (data?.msg_count) {
    DOM.msg_count.innerText = data.msg_count;
  }

  if (data && data.tokens !== undefined && DOM.tokens) {
    DOM.tokens.innerText = data.tokens.toString();
  }

  const optionDom = document.querySelector('.base-container');
  if (optionDom) optionDom.remove();
  streamData(data).then(messageSystems => {
    if (State.scroll_top.data)
      DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
    if (data.end) {
      enterEnd(messageSystems);
    }
  });

});

window.electronAPI.toolData((data) => {
  if (data.uuid && data.uuid !== State.uuid) {
    return;
  }
  updateChat(data as ChatState);
  if (data?.id !== State.chat.id) {
    return;
  }
  toolData(data)
});

window.electronAPI.infoData((data) => {
  if (data.uuid && data.uuid !== State.uuid) {
    return;
  }
  updateChat(data as ChatState);
  if (data?.id !== State.chat.id) {
    return;
  }
  if (data.content) {
    if (data && data.tokens !== undefined && DOM.tokens) {
      DOM.tokens.innerText = data.tokens.toString();
    }
    infoData(data).then(info_content => {
      if (State.scroll_top.info && info_content)
        info_content.scrollTop = info_content?.scrollHeight;
    });
  }
});

window.electronAPI.userData((data) => {
  if (data.uuid && data.uuid !== State.uuid) {
    return;
  }
  updateChat(data as ChatState);
  if (data?.id !== State.chat.id) {
    return;
  }
  userData(DOM.messages, data).then(messageSystem => {
    addRunning(messageSystem);
    if (State.scroll_top.data)
      DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
  })
});

window.electronAPI.startAgentLoop(async (data) => startAgentLoop(data));

window.electronAPI.handleExtraLoad((data) => {
  DOM.system_prompt.style.display = "none";
  DOM.file_upload.style.display = "none";
  DOM.act_plan.style.display = "none";
  data?.forEach((item: any) => {
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

window.electronAPI.handleOptions(({ options, group_id }) => {
  DOM.pause.style.display = "flex";
  let option_querys: string[] = [];

  options.forEach(value => {
    const option = document.createElement("div");
    option.className = "btn";
    option.dataset.id = group_id;
    option.innerText = value;
    option.addEventListener("click", function () {
      if (this.classList.contains("active")) {
        this.classList.remove("active");
        option_querys = option_querys.filter(item => item !== value);
        return;
      }
      this.classList.add("active");
      option_querys.push(value);
    });
    DOM.pause.appendChild(option);
  });

  const send = document.createElement("div");
  send.className = "btn success";
  send.dataset.id = group_id;
  send.innerText = "Send";
  send.addEventListener("click", async function () {
    State.formData.query = option_querys.join("\n");
    State.formData.prompt = DOM.system_prompt.value;
    startAgentLoop(State.formData);
    window.electronAPI.agentLoop(State.formData);
    option_querys = [];
  });
  DOM.pause.appendChild(send);

  if (State.scroll_top.data) DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
});

window.electronAPI.setPrompt((prompt) => DOM.system_prompt.value = prompt);

window.electronAPI.handleClear(() => handleClear());

window.electronAPI.uploadProgress((info) => updateProgress(info));

window.electronAPI.handleNewChat((chat) => handleNewChat(chat));

window.electronAPI.handleSelectChat((chat) => selectChat(chat.id));

window.electronAPI.handleSetChat(async (chat) => initChat(chat));

window.electronAPI.handleAutoRenameChat(async (data) => {
  if (data.uuid && data.uuid !== State.uuid) {
    return;
  }
  State.chat.id = data.id;
  await window.electronAPI.renameChat({ id: State.chat.id!, name: data.name });
  const items = DOM.history_list.getElementsByClassName("history-item");
  Array.from(items).forEach((item: any) => {
    if (item.id == State.chat.id)
      (item.getElementsByClassName("history-text")[0] as HTMLElement).innerText = data.name;
  });
});

// --- Global Exports (Fix for HTML inline events) ---
(window as any).hideConfig = hideConfig;
(window as any).saveConfig = saveConfig;
(window as any).showConfig = showConfig;
(window as any).confirmRename = confirmRename;
(window as any).hideRenameDialog = hideRenameDialog;
(window as any).selectChat = selectChat;
(window as any).renameChat = renameChat;
(window as any).deleteChat = deleteChat;
(window as any).showHistoryMenu = showHistoryMenu;
