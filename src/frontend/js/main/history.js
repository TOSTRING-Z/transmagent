import { DOM, State } from './globals';
import { createElement } from './utils';
import { toggleMode } from './ui';
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
export function addChatItem(chat) {
    const item = createElement(new_item_template.replace(/@id/g, chat.id));
    item.getElementsByClassName("history-text")[0].innerText = chat.name || "New Chat";
    item.getElementsByClassName("history-text")[0].title = chat.name || "New Chat";
    item.id = chat.id;
    DOM.history_list.insertBefore(item, DOM.history_list.firstChild);
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
export function newChat(chat) {
    addChatItem(chat);
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
        if (item.id == chat.id)
            item.classList.add("active");
        else
            item.classList.remove("active");
    });
}
export async function selectChat(chatId) {
    const chat = await window.electronAPI.loadChat(chatId);
    State.chat = chat;
    toggleMode(State.chat.mode);
    DOM.system_prompt.value = State.chat.system_prompt;
    DOM.tokens.innerText = State.chat.tokens.toString();
    DOM.msg_count.innerText = State.chat.msg_count?.toString() || "0";
    DOM.seconds.innerText = State.chat.seconds.toFixed(1);
    DOM.model_select.value = State.chat.model;
    DOM.compress_box.checked = State.chat.compress_context || false;
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item) => {
        if (item.id == chatId)
            item.classList.add("active");
        else
            item.classList.remove("active");
    });
}
export async function deleteChat(chatId) {
    if (confirm('Are you sure you want to delete this conversation?')) {
        await window.electronAPI.delChat(chatId);
        const items = DOM.history_list.getElementsByClassName("history-item");
        Array.from(items).forEach((item) => {
            if (item.id == chatId)
                item.remove();
        });
    }
}
export function showHistoryMenu(event, chatId) {
    event.stopPropagation();
    const menus = document.querySelectorAll('.history-menu-dropdown');
    menus.forEach((menu) => menu.style.display = 'none');
    const target = event.currentTarget;
    const menu = target.querySelector('.history-menu-dropdown');
    menu.style.display = 'block';
    State.chat.id = chatId;
}
export function renameChat(chatId) {
    State.chat.id = chatId;
    DOM.renameDialog.style.display = 'flex';
    DOM.renameInput.focus();
}
export async function confirmRename() {
    const newName = DOM.renameInput.value.trim();
    if (newName && State.chat.id) {
        await window.electronAPI.renameChat({ id: State.chat.id, name: newName });
        const items = DOM.history_list.getElementsByClassName("history-item");
        Array.from(items).forEach((item) => {
            if (item.id == State.chat.id)
                item.getElementsByClassName("history-text")[0].innerText = newName;
        });
    }
    DOM.renameDialog.style.display = 'none';
    DOM.renameInput.value = '';
}
