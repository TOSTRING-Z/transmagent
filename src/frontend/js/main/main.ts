import { DOM, State } from './globals';
import { init_size, autoResizeTextarea, loadOptions, showLog, toggleMode, toggleSidebar, updateProgress, showRenameDialog, hideRenameDialog } from './ui';
import { addChatItem, newChat, selectChat, deleteChat, renameChat, confirmRename, showHistoryMenu } from './history';
import { initConfigEvents, showConfig, saveConfig, hideConfig } from './config';
import { userData, infoData, streamData, startAgentLoop, menuEvent, addRunning, toolData, enterEnd } from './chat';
import { initMermaid, marked } from './markdown';
import { getFileName, getIcon, formatString } from './utils';

// --- Event Listeners & Initialization ---

document.addEventListener("DOMContentLoaded", () => {
  init_size();
  autoResizeTextarea(DOM.input);
  initMermaid();
  loadOptions();
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

  // Auto Opt
  DOM.auto_opt.addEventListener('click', async (e: any) => {
    e.target.classList.toggle("active");
    await window.electronAPI.toggleAutoOpt();
  });

  // Sidebar & Config Buttons
  const collapseBtn = document.querySelector('.collapse-btn');
  if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebar);

  const configBtn = document.querySelector('.config-btn');
  if (configBtn) configBtn.addEventListener('click', showConfig);

  DOM.btn_new_chat.addEventListener("click", async () => {
    const chat = await window.electronAPI.newChat();
    newChat(chat);
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

window.electronAPI.initInfo((info) => {
  toggleMode(info.chat.mode);
  DOM.system_prompt.value = info.chat.system_prompt;
  DOM.version.innerText = info.version;
  DOM.history_list.innerHTML = ""; // Clear list before adding
  info.chats.forEach((chat: any) => addChatItem(chat));

  if (State.seconds_timer) clearInterval(State.seconds_timer);
  State.seconds_timer = null;

  State.chat = info.chat;
  DOM.tokens.innerText = State.chat.tokens.toString();
  DOM.seconds.innerText = State.chat.seconds.toString();

  State.status = info.status;
  if (State.status.auto_opt) DOM.auto_opt.classList.add("active");
  else DOM.auto_opt.classList.remove("active");
});

window.electronAPI.handleMarkDownFormat((status) => State.markdown_statu = status);

window.electronAPI.handleReactStatu((status) => State.react_statu = status);

window.electronAPI.streamData((chunk) => {
  if (chunk.chat?.msg_count) {
    DOM.msg_count.innerText = chunk.chat.msg_count;
  }

  if (chunk.chat && chunk.chat.tokens !== undefined && DOM.tokens) {
    DOM.tokens.innerText = chunk.chat.tokens.toString();
  }

  const optionDom = document.querySelector('.base-container');
  if (optionDom) optionDom.remove();
  streamData(chunk).then(messageSystems => {
    if (State.scroll_top.data)
      DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
    if (chunk.end) {
      DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
      enterEnd(messageSystems);
    }
  });

});

window.electronAPI.toolData((chunk) => toolData(chunk));

window.electronAPI.infoData((info) => {
  if (info.content) {
    if (info.chat && info.chat.tokens !== undefined && DOM.tokens) {
      DOM.tokens.innerText = info.chat.tokens.toString();
    }
    infoData(info)
    if (State.scroll_top.data)
      DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
  }
});

window.electronAPI.userData((data) => {
  userData(DOM.messages, data).then(messageSystem => {
    addRunning(messageSystem);
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

window.electronAPI.handleClear(() => loadOptions());

window.electronAPI.uploadProgress((info) => updateProgress(info));

window.electronAPI.handleNewChat((chat) => newChat(chat));

window.electronAPI.handleSelectChat((chat) => selectChat(chat.id));

window.electronAPI.handleSetChat(async (chat) => {
  const items = DOM.history_list.getElementsByClassName("history-item");
  Array.from(items).forEach((item: any) => {
    if (item.id == State.chat.id)
      (item.getElementsByClassName("history-text")[0] as HTMLElement).innerText = chat.name;
  });
  State.chat = chat;
  toggleMode(State.chat.mode);
  DOM.system_prompt.value = State.chat.system_prompt;
  DOM.tokens.innerText = State.chat.tokens.toString();
  DOM.msg_count.innerText = State.chat.msg_count?.toString() || "0";
  DOM.seconds.innerText = State.chat.seconds.toFixed(1);
  if (State.chat.version && DOM.version) DOM.version.innerText = State.chat.version;
});

window.electronAPI.handleAutoRenameChat(async (chat) => {
  State.chat.id = chat.id;
  await window.electronAPI.renameChat({ id: State.chat.id!, name: chat.name });
  const items = DOM.history_list.getElementsByClassName("history-item");
  Array.from(items).forEach((item: any) => {
    if (item.id == State.chat.id)
      (item.getElementsByClassName("history-text")[0] as HTMLElement).innerText = chat.name;
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
