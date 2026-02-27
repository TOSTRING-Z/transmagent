"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("./globals");
const ui_1 = require("./ui");
const history_1 = require("./history");
const config_1 = require("./config");
const chat_1 = require("./chat");
const markdown_1 = require("./markdown");
const utils_1 = require("./utils");
// --- Event Listeners & Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    (0, ui_1.init_size)();
    (0, ui_1.autoResizeTextarea)(globals_1.DOM.input);
    (0, markdown_1.initMermaid)();
    (0, ui_1.loadOptions)();
    (0, config_1.initConfigEvents)();
    // Resize Observer
    if (globals_1.DOM.bottom_div && globals_1.DOM.top_div) {
        const resizeObserver = new ResizeObserver(() => {
            globals_1.DOM.top_div.style.height = (window.innerHeight - globals_1.DOM.bottom_div.clientHeight) + "px";
        });
        resizeObserver.observe(globals_1.DOM.bottom_div);
    }
    // Window Resize
    window.addEventListener("resize", () => (0, ui_1.init_size)());
    // Global Click (Close Menus)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.history-menu')) {
            document.querySelectorAll('.history-menu-dropdown').forEach((m) => m.style.display = 'none');
        }
        if (!["input", "system_prompt"].includes(e.target.id)) {
            (0, ui_1.init_size)();
        }
    });
    // Input Events
    if (globals_1.DOM.input) {
        const handleInput = (e) => {
            (0, ui_1.autoResizeTextarea)(e.target);
            if (globals_1.DOM.submit) {
                if (e.target.value.trim() !== '')
                    globals_1.DOM.submit.classList.add('success');
                else
                    globals_1.DOM.submit.classList.remove('success');
            }
        };
        globals_1.DOM.input.addEventListener("input", handleInput);
        globals_1.DOM.input.addEventListener("click", handleInput);
    }
    if (globals_1.DOM.system_prompt) {
        const handleSysPrompt = () => (0, ui_1.autoResizeTextarea)(globals_1.DOM.system_prompt);
        globals_1.DOM.system_prompt.addEventListener("input", handleSysPrompt);
        globals_1.DOM.system_prompt.addEventListener("click", handleSysPrompt);
    }
    // Mode Toggles
    globals_1.DOM.auto.addEventListener("click", () => (0, ui_1.toggleMode)("auto"));
    globals_1.DOM.act.addEventListener("click", () => (0, ui_1.toggleMode)("act"));
    globals_1.DOM.plan.addEventListener("click", () => (0, ui_1.toggleMode)("plan"));
    globals_1.DOM.flash.addEventListener("click", () => (0, ui_1.toggleMode)("flash"));
    // File Upload
    globals_1.DOM.file_upload.addEventListener("click", async (e) => {
        globals_1.State.formData.file_path = await window.electronAPI.getFilePath();
        e.target.innerText = globals_1.State.formData.file_path ? (0, utils_1.getFileName)(globals_1.State.formData.file_path) : "Select file";
    });
    // Submit
    globals_1.DOM.submit.addEventListener("click", async () => {
        if (globals_1.DOM.submit.classList.contains("running")) {
            const messageSystemList = document.querySelectorAll('[data-role="system"]');
            if (messageSystemList.length > 0) {
                const messageSystem = messageSystemList[messageSystemList.length - 1];
                const btn = messageSystem.getElementsByClassName("btn")[0];
                btn?.click();
            }
        }
        else {
            globals_1.State.formData.query = globals_1.DOM.input.value;
            globals_1.State.formData.prompt = globals_1.DOM.system_prompt.value;
            window.electronAPI.clickSubmit(globals_1.State.formData);
            globals_1.DOM.pause.style.display = "none";
            globals_1.DOM.pause.innerHTML = "";
        }
    });
    // Auto Opt
    globals_1.DOM.auto_opt.addEventListener('click', async (e) => {
        e.target.classList.toggle("active");
        await window.electronAPI.toggleAutoOpt();
    });
    // Sidebar & Config Buttons
    const collapseBtn = document.querySelector('.collapse-btn');
    if (collapseBtn)
        collapseBtn.addEventListener('click', ui_1.toggleSidebar);
    const configBtn = document.querySelector('.config-btn');
    if (configBtn)
        configBtn.addEventListener('click', config_1.showConfig);
    globals_1.DOM.btn_new_chat.addEventListener("click", async () => {
        const chat = await window.electronAPI.newChat();
        (0, history_1.newChat)(chat);
    });
    // Rename Dialog
    const confirmRenameBtn = document.getElementById('confirmRename');
    if (confirmRenameBtn)
        confirmRenameBtn.addEventListener('click', history_1.confirmRename);
    const cancelRenameBtn = document.getElementById('cancelRename');
    if (cancelRenameBtn)
        cancelRenameBtn.addEventListener('click', ui_1.hideRenameDialog);
    // Config Modal
    const saveConfigBtn = document.getElementById('save-config');
    if (saveConfigBtn)
        saveConfigBtn.addEventListener('click', config_1.saveConfig);
    const cancelConfigBtn = document.getElementById('cancel-config');
    if (cancelConfigBtn)
        cancelConfigBtn.addEventListener('click', config_1.hideConfig);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape')
            (0, config_1.hideConfig)();
    });
});
// --- Electron API Handlers ---
window.electronAPI.handleLog((log) => (0, ui_1.showLog)(log.type, log.content));
window.electronAPI.handleDeleteMemory(({ context_ids, ids }) => {
    let elements = document.querySelectorAll(`[info_data-id]`);
    elements.forEach((element) => {
        if (context_ids.includes(parseInt(element.getAttribute('info_data-id')))) {
            if (!element.classList.contains('del'))
                element.classList.add('del');
        }
        else if (element.classList.contains('del')) {
            element.classList.remove('del');
        }
    });
    elements = document.querySelectorAll(`[chunk_data-id]`);
    elements.forEach((element) => {
        if (context_ids.includes(parseInt(element.getAttribute('chunk_data-id')))) {
            if (!element.classList.contains('del'))
                element.classList.add('del');
        }
        else if (element.classList.contains('del')) {
            element.classList.remove('del');
        }
    });
    elements = document.querySelectorAll(`[data-id]`);
    elements.forEach((element) => {
        if (ids.includes(parseInt(element.getAttribute('data-id')))) {
            if (!element.classList.contains('message_del'))
                element.classList.add('message_del');
        }
        else if (element.classList.contains('message_del')) {
            element.classList.remove('message_del');
        }
    });
});
window.electronAPI.initInfo((info) => {
    (0, ui_1.toggleMode)(info.chat.mode);
    globals_1.DOM.system_prompt.value = info.chat.system_prompt;
    globals_1.DOM.version.innerText = info.version;
    globals_1.DOM.history_list.innerHTML = ""; // Clear list before adding
    info.chats.forEach((chat) => (0, history_1.addChatItem)(chat));
    if (globals_1.State.seconds_timer)
        clearInterval(globals_1.State.seconds_timer);
    globals_1.State.seconds_timer = null;
    globals_1.State.chat = info.chat;
    globals_1.DOM.tokens.innerText = globals_1.State.chat.tokens.toString();
    globals_1.DOM.seconds.innerText = globals_1.State.chat.seconds.toString();
    globals_1.State.status = info.status;
    if (globals_1.State.status.auto_opt)
        globals_1.DOM.auto_opt.classList.add("active");
    else
        globals_1.DOM.auto_opt.classList.remove("active");
});
window.electronAPI.handleChangeMode((mode) => (0, ui_1.toggleMode)(mode, false));
window.electronAPI.handleMarkDownFormat((status) => globals_1.State.markdown_statu = status);
window.electronAPI.handleReactStatu((status) => globals_1.State.react_statu = status);
window.electronAPI.streamData((chunk) => (0, chat_1.streamMessageAdd)(chunk));
window.electronAPI.infoData((info) => (0, chat_1.infoAdd)(info));
window.electronAPI.userData((data) => (0, chat_1.userAdd)(data));
window.electronAPI.handleQuery(async ({ data, api_callback = true }) => {
    globals_1.DOM.pause.style.display = "none";
    globals_1.DOM.pause.innerHTML = "";
    const optionDom = document.querySelector('.base-container');
    if (optionDom)
        optionDom.remove();
    if (globals_1.State.seconds_timer)
        clearInterval(globals_1.State.seconds_timer);
    globals_1.State.seconds_timer = setInterval(() => {
        globals_1.State.chat.seconds += 0.1;
        globals_1.DOM.seconds.innerText = globals_1.State.chat.seconds.toFixed(1);
        if (globals_1.State.chat.version && globals_1.DOM.version)
            globals_1.DOM.version.innerText = globals_1.State.chat.version;
    }, 100);
    globals_1.DOM.tokens.innerText = globals_1.State.chat.tokens.toString();
    globals_1.DOM.version.innerText = data.version;
    data.prompt = globals_1.DOM.system_prompt.value;
    let user_content = data.img_url ? globals_1.DOM.input.value : data.query;
    // Optimistically add user message
    // Note: userAdd expects object structure matching what formatMessage needs
    // We need to construct a pseudo-data object if handleQuery doesn't provide fully formatted one yet?
    // Usually handleQuery data comes from backend which is consistent. 
    // Let's assume data structure is correct or used `userAdd` logic:
    // The original code calls `messages.appendChild(await user_message.formatMessage(...))`
    // We can just use userAdd if data structure matches, or manually call userAdd logic here.
    // Since `userAdd` is exported, let's reuse it or manual append if params differ.
    // Original code manual append:
    /*
    messages.appendChild(await user_message.formatMessage({
      "id": data.id,
      "message": user_content,
      "image_url": data.img_url,
    }, "user"));
    */
    // We can adapt `userAdd` or just replicate:
    await (0, chat_1.userAdd)({
        id: data.id,
        content: user_content,
        img_url: data.img_url
    });
    // But wait, userAdd logic handles content as string or array. Here it is string. 
    // System placeholder
    /*
    let messageSystem = await system_message.formatMessage({
      "icon": getIcon(data.is_plugin),
      "id": data.id,
      "message": ""
    }, "system")
    addEventStop(messageSystem);
    messages.appendChild(messageSystem);
    */
    // We don't have a direct function for adding EMPTY system message in chat.ts, 
    // `userAdd` adds both user and empty system message! 
    // Let's check chat.ts `userAdd`: 
    // It appends user message AND system message. 
    // So calling `userAdd` is enough!
    globals_1.DOM.top_div.scrollTop = globals_1.DOM.top_div.scrollHeight;
    if (api_callback)
        window.electronAPI.queryText(data);
});
window.electronAPI.handleExtraLoad((data) => {
    globals_1.DOM.system_prompt.style.display = "none";
    globals_1.DOM.file_upload.style.display = "none";
    globals_1.DOM.act_plan.style.display = "none";
    data?.forEach((item) => {
        switch (item.type) {
            case "system-prompt":
                globals_1.DOM.system_prompt.style.display = "block";
                break;
            case "file-upload":
                globals_1.DOM.file_upload.style.display = "flex";
                break;
            case "act-plan":
                globals_1.DOM.act_plan.style.display = "flex";
                break;
        }
    });
    (0, ui_1.init_size)();
});
window.electronAPI.handleOptions(({ options, id }) => {
    globals_1.DOM.pause.style.display = "flex";
    let option_querys = [];
    options.forEach(value => {
        const option = document.createElement("div");
        option.className = "btn";
        option.dataset.id = id;
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
        globals_1.DOM.pause.appendChild(option);
    });
    const send = document.createElement("div");
    send.className = "btn success";
    send.dataset.id = id;
    send.innerText = "Send";
    send.addEventListener("click", async function () {
        globals_1.State.formData.query = option_querys.join("\n");
        globals_1.State.formData.prompt = globals_1.DOM.system_prompt.value;
        window.electronAPI.clickSubmit(globals_1.State.formData);
        option_querys = [];
        globals_1.DOM.pause.style.display = "none";
        globals_1.DOM.pause.innerHTML = "";
    });
    globals_1.DOM.pause.appendChild(send);
    if (globals_1.State.scroll_top.data)
        globals_1.DOM.top_div.scrollTop = globals_1.DOM.top_div.scrollHeight;
});
window.electronAPI.setPrompt((prompt) => globals_1.DOM.system_prompt.value = prompt);
window.electronAPI.handleClear(() => (0, ui_1.loadOptions)());
window.electronAPI.uploadProgress((info) => (0, ui_1.updateProgress)(info));
window.electronAPI.handleNewChat((chat) => (0, history_1.newChat)(chat));
window.electronAPI.handleSelectChat((chat) => (0, history_1.selectChat)(chat.id));
window.electronAPI.handleSetChat(async (chat) => {
    const items = globals_1.DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
        if (item.id == globals_1.State.chat.id)
            item.getElementsByClassName("history-text")[0].innerText = chat.name;
    });
    globals_1.State.chat = chat;
    (0, ui_1.toggleMode)(globals_1.State.chat.mode);
    globals_1.DOM.system_prompt.value = globals_1.State.chat.system_prompt;
    globals_1.DOM.tokens.innerText = globals_1.State.chat.tokens.toString();
    globals_1.DOM.msg_count.innerText = globals_1.State.chat.msg_count?.toString() || "0";
    globals_1.DOM.seconds.innerText = globals_1.State.chat.seconds.toFixed(1);
    if (globals_1.State.chat.version && globals_1.DOM.version)
        globals_1.DOM.version.innerText = globals_1.State.chat.version;
});
window.electronAPI.handleAutoRenameChat(async (chat) => {
    globals_1.State.chat.id = chat.id;
    await window.electronAPI.renameChat({ id: globals_1.State.chat.id, name: chat.name });
    const items = globals_1.DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
        if (item.id == globals_1.State.chat.id)
            item.getElementsByClassName("history-text")[0].innerText = chat.name;
    });
});
// --- Global Exports (Fix for HTML inline events) ---
window.hideConfig = config_1.hideConfig;
window.saveConfig = config_1.saveConfig;
window.showConfig = config_1.showConfig;
window.confirmRename = history_1.confirmRename;
window.hideRenameDialog = ui_1.hideRenameDialog;
window.selectChat = history_1.selectChat;
window.renameChat = history_1.renameChat;
window.deleteChat = history_1.deleteChat;
window.showHistoryMenu = history_1.showHistoryMenu;
//# sourceMappingURL=main.js.map