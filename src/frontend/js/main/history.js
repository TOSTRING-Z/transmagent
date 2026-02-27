"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmRename = exports.renameChat = exports.showHistoryMenu = exports.deleteChat = exports.selectChat = exports.newChat = exports.addChatItem = void 0;
const globals_1 = require("./globals");
const utils_1 = require("./utils");
const ui_1 = require("./ui");
const new_item_template = `<div class="history-item" onclick="selectChat('@id')">
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
    const item = (0, utils_1.createElement)(new_item_template.replace(/@id/g, chat.id));
    item.getElementsByClassName("history-text")[0].innerText = chat.name || "New Chat";
    item.getElementsByClassName("history-text")[0].title = chat.name || "New Chat";
    item.id = chat.id;
    globals_1.DOM.history_list.insertBefore(item, globals_1.DOM.history_list.firstChild);
    // Re-bind events because inline onclicks in string templates might not work as expected in modules scope
    // But wait, inline onclicks rely on global functions. 
    // In a module system, we should attach event listeners manually or expose functions to window.
    // Here we will use manual attachment for cleaner code.
    item.onclick = () => selectChat(chat.id);
    const menu = item.querySelector('.history-menu');
    menu.onclick = (e) => showHistoryMenu(e, chat.id);
    const renameBtn = item.querySelector('.history-menu-item:nth-child(1)');
    renameBtn.onclick = (e) => { e.stopPropagation(); renameChat(chat.id); };
    const deleteBtn = item.querySelector('.history-menu-item:nth-child(2)');
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteChat(chat.id); };
}
exports.addChatItem = addChatItem;
function newChat(chat) {
    addChatItem(chat);
    const items = globals_1.DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
        if (item.id == chat.id)
            item.classList.add("active");
        else
            item.classList.remove("active");
    });
}
exports.newChat = newChat;
async function selectChat(chatId) {
    const chat = await window.electronAPI.loadChat(chatId);
    globals_1.State.chat = chat;
    (0, ui_1.toggleMode)(globals_1.State.chat.mode);
    globals_1.DOM.system_prompt.value = globals_1.State.chat.system_prompt;
    globals_1.DOM.tokens.innerText = globals_1.State.chat.tokens.toString();
    globals_1.DOM.msg_count.innerText = globals_1.State.chat.msg_count?.toString() || "0";
    globals_1.DOM.seconds.innerText = globals_1.State.chat.seconds.toFixed(1);
    const items = globals_1.DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
        if (item.id == chatId)
            item.classList.add("active");
        else
            item.classList.remove("active");
    });
}
exports.selectChat = selectChat;
async function deleteChat(chatId) {
    if (confirm('Are you sure you want to delete this conversation?')) {
        await window.electronAPI.delChat(chatId);
        const items = globals_1.DOM.history_list.getElementsByClassName("history-item");
        Array.from(items).forEach((item) => {
            if (item.id == chatId)
                item.remove();
        });
    }
}
exports.deleteChat = deleteChat;
function showHistoryMenu(event, chatId) {
    event.stopPropagation();
    const menus = document.querySelectorAll('.history-menu-dropdown');
    menus.forEach((menu) => menu.style.display = 'none');
    const target = event.currentTarget;
    const menu = target.querySelector('.history-menu-dropdown');
    menu.style.display = 'block';
    globals_1.State.chat.id = chatId;
}
exports.showHistoryMenu = showHistoryMenu;
function renameChat(chatId) {
    globals_1.State.chat.id = chatId;
    globals_1.DOM.renameDialog.style.display = 'flex';
    globals_1.DOM.renameInput.focus();
}
exports.renameChat = renameChat;
async function confirmRename() {
    const newName = globals_1.DOM.renameInput.value.trim();
    if (newName && globals_1.State.chat.id) {
        await window.electronAPI.renameChat({ id: globals_1.State.chat.id, name: newName });
        const items = globals_1.DOM.history_list.getElementsByClassName("history-item");
        Array.from(items).forEach((item) => {
            if (item.id == globals_1.State.chat.id)
                item.getElementsByClassName("history-text")[0].innerText = newName;
        });
    }
    globals_1.DOM.renameDialog.style.display = 'none';
    globals_1.DOM.renameInput.value = '';
}
exports.confirmRename = confirmRename;
//# sourceMappingURL=history.js.map