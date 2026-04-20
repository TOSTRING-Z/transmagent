import { DOM } from './globals';
import { State } from './state';
import { createElement } from './utils';
import { toggleMode } from './ui';

const new_item_template = `<div class="history-item" onclick="loadChat('@id')">
    <div class="history-status"></div>
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

export function addChatItem(chat: any) {
  const item = createElement(new_item_template.replace(/@id/g, chat.id));
  (item.getElementsByClassName("history-text")[0] as HTMLElement).innerText = chat.name || "New Chat";
  (item.getElementsByClassName("history-text")[0] as HTMLElement).title = chat.name || "New Chat";
  item.id = chat.id;
  DOM.history_list.insertBefore(item, DOM.history_list.firstChild);

  item.onclick = () => loadChat(chat.id);
  const menu = item.querySelector('.history-menu') as HTMLElement;
  menu.onclick = (e) => showHistoryMenu(e, chat.id);
  const renameBtn = item.querySelector('.history-menu-item:nth-child(1)') as HTMLElement;
  renameBtn.onclick = (e) => { e.stopPropagation(); renameChat(chat.id); };
  const deleteBtn = item.querySelector('.history-menu-item:nth-child(2)') as HTMLElement;
  deleteBtn.onclick = (e) => { e.stopPropagation(); deleteChat(chat.id); };
}

export function handleNewChat(chat: any) {
  addChatItem(chat);
  updateChat(chat);
  selectChat(chat.id);
}

export function updateChat(chat: any) {
  if (!chat) return;

  // Update the main state
  State.chat = chat;

  // Update UI elements to reflect the current chat state
  toggleMode(State.chat.mode);
  DOM.system_prompt.value = State.chat.system_prompt || "";
  DOM.tokens.innerText = String(State.chat.tokens || 0);
  DOM.msg_count.innerText = String(State.chat.msg_count || 0);
  DOM.seconds.innerText = (State.chat.seconds || 0).toFixed(1);
  DOM.version.innerText = State.chat.version || "deepseek-chat";
  DOM.agentMode.innerText = State.chat.agentMode || "transagent";
  DOM.model_select.value = State.chat.model;
  DOM.compress_box.checked = State.chat.compress_context || false;
}

export async function selectChat(chatId: string) {
  const items = DOM.history_list.getElementsByClassName("history-item");
  Array.from(items).forEach((item: any) => {
    if (item.id == chatId) item.classList.add("active");
    else item.classList.remove("active");
  });
}

export async function loadChat(chatId: string) {
  window.electronAPI.loadChat(chatId);
}

export async function handleloadChat(chat: any) {
  updateChat(chat);
  selectChat(chat.id);
}

export async function deleteChat(chatId: string) {
  if (confirm('Are you sure you want to delete this conversation?')) {
    await window.electronAPI.delChat(chatId);
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item: any) => {
      if (item.id == chatId) item.remove();
    });
  }
}

export function showHistoryMenu(event: Event, chatId: string) {
  event.stopPropagation();
  const menus = document.querySelectorAll('.history-menu-dropdown');
  menus.forEach((menu: any) => menu.style.display = 'none');

  const target = event.currentTarget as HTMLElement;
  const menu = target.querySelector('.history-menu-dropdown') as HTMLElement;
  menu.style.display = 'block';
  State.chat.id = chatId;
}

export function renameChat(chatId: string) {
  State.chat.id = chatId;
  DOM.renameDialog.style.display = 'flex';
  DOM.renameInput.focus();
}

export async function confirmRename() {
  const newName = DOM.renameInput.value.trim();
  if (newName && State.chat.id) {
    await window.electronAPI.renameChat({ id: State.chat.id, name: newName });
    const items = DOM.history_list.getElementsByClassName("history-item");
    Array.from(items).forEach((item: any) => {
      if (item.id == State.chat.id)
        (item.getElementsByClassName("history-text")[0] as HTMLElement).innerText = newName;
    });
  }
  DOM.renameDialog.style.display = 'none';
  DOM.renameInput.value = '';
}

// Status indicator functions for running sessions
export function setHistoryRunning(chatId: string) {
  const item = document.getElementById(chatId);
  if (item) {
    item.classList.remove('completed');
    item.classList.add('running');
  }
}

export function setHistoryCompleted(chatId: string) {
  const item = document.getElementById(chatId);
  if (item) {
    item.classList.remove('running');
    item.classList.add('completed');
  }
}
