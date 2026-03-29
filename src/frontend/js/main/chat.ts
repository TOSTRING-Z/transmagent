import { DOM, State } from './globals';
import { createElement, getIcon, formatString } from './utils';
import { marked } from './markdown';
import { showLog } from './ui';

// Templates
const user_message_template = `<div class="relative space-y-2 space-x-2" data-role="user" data-id="">
  <div class="flex flex-row-reverse w-full">
    <div class="menu-container">
      <img class="menu user" src="img/user.svg" alt="User Avatar">
    </div>
    <div class="message"></div>
  </div>
</div>`;

const system_message_template = `<div class="relative space-y-2 space-x-2" data-role="system" data-id="">
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

// Helper: Format Message
async function formatMessage(template: string, params: any, role: string): Promise<HTMLElement> {
  const newElement = createElement(template);
  let message = newElement.getElementsByClassName("message")[0] as HTMLElement;

  if (Object.prototype.hasOwnProperty.call(params, "icon")) {
    let menu = newElement.getElementsByClassName("menu")[0] as HTMLImageElement;
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

// Action Handlers

export async function toggleMessageGroup(group_id: any) {
  let elements = document.querySelectorAll(`[data-id="${group_id}"]`);
  elements.forEach(async function (message_element: any) {
    if (message_element.classList.contains('message_del')) {
      let { del_mode } = await window.electronAPI.toggleMessageGroup({ group_id: group_id, del: false });
      if (del_mode) {
        message_element.remove();
      } else {
        message_element.classList.remove('message_del');
        message_element.querySelectorAll("[info_data-id]").forEach((element: HTMLElement) => {
          if (element.classList.contains('del')) element.classList.remove('del');
        });
        message_element.querySelectorAll("[chunk_data-id]").forEach((element: HTMLElement) => {
          if (element.classList.contains('del')) element.classList.remove('del');
        });
      }
    } else {
      let { del_mode } = await window.electronAPI.toggleMessageGroup({ group_id: group_id, del: true });
      if (del_mode) {
        message_element.remove();
      } else {
        message_element.classList.add('message_del');
        message_element.classList.add('message_toggle');
        message_element.querySelectorAll("[info_data-id]").forEach((element: HTMLElement) => {
          if (!element.classList.contains('del')) element.classList.add('del');
        });
        message_element.querySelectorAll("[chunk_data-id]").forEach((element: HTMLElement) => {
          if (!element.classList.contains('del')) element.classList.add('del');
        });
      }
    }
  });
}

export async function toggleContextMessage(context_id: string) {
  let { del_mode } = await window.electronAPI.toggleContextMessage(context_id);
  let elements = document.querySelectorAll(`[info_data-id="${context_id}"]`);
  elements.forEach(function (element) {
    if (del_mode) element.remove();
    else element.classList.toggle('del');
  });
  elements = document.querySelectorAll(`[chunk_data-id="${context_id}"]`);
  elements.forEach(function (element) {
    if (del_mode) element.remove();
    else element.classList.toggle('del');
  });
}

let compression_tasks: Record<string, boolean> = {};

export async function compressionGroupMessage(group_id: string) {
  let elements = document.querySelectorAll(`[data-id="${group_id}"]`);
  showLog('log', `Compressing message (id: ${group_id})...`);
  compression_tasks[group_id] = true;
  if (DOM.submit.classList.contains('running') == false) {
    DOM.submit.classList.add('running');
  }
  let { compression_content } = await window.electronAPI.compressionGroupMessage({ group_id });
  showLog('success', `Message compressed (id: ${group_id}).`);
  let keptUser = false;
  elements.forEach(async function (message_element: any) {
    if (!keptUser) {
      keptUser = true;
      let messageSystem = await formatMessage(system_message_template, {
        "icon": getIcon(false),
        "id": group_id,
        "message": compression_content
      }, "system");
      addRunning(messageSystem);
      const thinking = messageSystem.getElementsByClassName("thinking")[0];
      thinking.remove();
      const message_content = messageSystem.getElementsByClassName('message')[0] as HTMLElement;
      menuEvent(messageSystem, message_content, false);
      message_element.parentElement.insertBefore(messageSystem, message_element.nextSibling);
      delete compression_tasks[group_id];
      if (Object.keys(compression_tasks).length == 0) {
        DOM.submit.classList.remove('running');
      }
    } else {
      message_element.remove();
    }
  });
}

export async function thumbMessageGroup(up: HTMLElement, down: HTMLElement, data: any) {
  let thumb = await window.electronAPI.thumbMessageGroup(data);
  if (thumb === 1) {
    if (!up.classList.contains("success")) up.classList.add("success");
    if (down.classList.contains("success")) down.classList.remove("success");
  } else if (thumb === -1) {
    if (!down.classList.contains("success")) down.classList.add("success");
    if (up.classList.contains("success")) up.classList.remove("success");
  } else {
    if (up.classList.contains("success")) up.classList.remove("success");
    if (down.classList.contains("success")) down.classList.remove("success");
  }
}

export function locateContextMessage(context_id: number) {
  let elements = document.querySelectorAll(`[info_data-id="${context_id}"]`);
  if (elements.length > 0)
    elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function quoteContextMessage(context_id: number) {
  const quotedContent = `Please invoke the memory_retrieval tool using context_id: ${context_id}`;
  DOM.input.value = quotedContent + '\n' + DOM.input.value;
}

export function menuEvent(messageSystem: HTMLElement, message_content: HTMLElement, is_plugin: boolean) {
  const copy = messageSystem.getElementsByClassName("copy")[0] as HTMLElement;
  const del = messageSystem.getElementsByClassName("delete")[0] as HTMLElement;
  const compression = messageSystem.getElementsByClassName("compression")[0] as HTMLElement;
  const toggle = messageSystem.getElementsByClassName("toggle")[0] as HTMLElement;
  const thumbs_up = messageSystem.getElementsByClassName("thumbs-up")[0] as HTMLElement;
  const thumbs_down = messageSystem.getElementsByClassName("thumbs-down")[0] as HTMLElement;

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
      showLog('success', 'Copy successful');
    }).catch(err => {
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
    compressionGroupMessage(messageSystem.dataset.id as string);
  });
  thumbMessageGroup(thumbs_up, thumbs_down, { group_id: messageSystem.dataset.id, thumb: 0 });
  thumbs_up.addEventListener("click", () => {
    thumbMessageGroup(thumbs_up, thumbs_down, { group_id: messageSystem.dataset.id, thumb: 1 });
  });
  thumbs_down.addEventListener("click", () => {
    thumbMessageGroup(thumbs_up, thumbs_down, { group_id: messageSystem.dataset.id, thumb: -1 });
  });
}

export async function enterEnd(messageSystem: HTMLElement) {
  if (State.seconds_timer) clearInterval(State.seconds_timer);
  const message_content = messageSystem.getElementsByClassName('message')[0] as HTMLElement;
  const thinking = messageSystem?.getElementsByClassName("thinking")[0];
  thinking.classList.add('hidden');
  menuEvent(messageSystem, message_content.dataset.content as any, false);
  DOM.submit.classList.remove("running");
}

export function addRunning(messageSystem: HTMLElement) {
  DOM.submit.classList.add("running");
  const thinking = messageSystem?.getElementsByClassName("thinking")[0];
  thinking.classList.remove('hidden');
  const btn = messageSystem?.getElementsByClassName("btn")[0];
  btn?.addEventListener("click", async () => {
    await window.electronAPI.stopMessage();
    enterEnd(messageSystem);
  });
}

// Main Chat Functions

export async function userData(messages: HTMLElement, data: any) {
  let messageUser;
  if (typeof (data.content) == "string") {
    messageUser = await formatMessage(user_message_template, {
      "id": data.group_id,
      "message": data.content,
      "image_url": data?.img_url,
    }, "user");
  } else {
    messageUser = await formatMessage(user_message_template, {
      "id": data.group_id,
      "message": data.content[0].text.content,
      "image_url": data.content[1].image_url.url,
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
  }
  return messageSystem;
}

export async function infoData(info: any) {
  const messageSystems = document.querySelectorAll(`[data-id='${info.group_id}']`);
  const messageSystem = messageSystems[1];
  if (messageSystem) {
    const info_content = messageSystem.getElementsByClassName('info-content')[0] as HTMLElement;
    const info_div = messageSystem.getElementsByClassName('info')[0] as HTMLElement;
    if (info_div && info_div.classList.contains('hidden')) {
      info_div.classList.remove('hidden');
    }
    if (info.content) {
      let info_item_content = await marked.parse(info.content);
      let info_item = createElement(`<div info_data-id="${info.context_id}">
    <div class="info-item">
    </div>
  </div>`);
      if (info?.del) info_item.classList.add("del");
      info_item.getElementsByClassName('info-item')[0].innerHTML = info_item_content;
      info_content.appendChild(info_item);
      info_content.dataset.content = (info_content.dataset.content || '') + info.content;
    }
    return info_content;
  }
}

export async function toolData(chunk: any) {
  const messageSystems = document.querySelectorAll(`[data-id='${chunk.group_id}']`);
  const messageSystem = messageSystems[1] as HTMLElement;
  addRunning(messageSystem);
  streamData(chunk);
}

export async function streamData(chunk: any): Promise<HTMLElement> {
  const messageSystems = document.querySelectorAll(`[data-id='${chunk.group_id}']`);
  const messageSystem = messageSystems[1] as HTMLElement;
  if (messageSystem) {
    const message_content = messageSystem.getElementsByClassName('message')[0] as HTMLElement;
    if (chunk.content) {
      let context_id = Object.prototype.hasOwnProperty.call(chunk, "context_id") ? chunk.context_id : chunk.group_id;

      let chunk_content = null;
      let chunk_item_content = null;
      let chunk_item = null;
      let chunk_item_query = message_content.querySelectorAll(`[chunk_data-id='${context_id}']`);

      if (chunk_item_query.length > 0) {
        let existingItem = chunk_item_query[0] as HTMLElement;
        chunk_content = (existingItem.dataset.content || '') + chunk.content;
        chunk_item_content = await marked.parse(chunk_content);
        chunk_item = existingItem;
        chunk_item.dataset.content = chunk_content;
        chunk_item.getElementsByClassName('chunk-content')[0].innerHTML = chunk_item_content;
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
        if (chunk?.del) chunk_item.classList.add("del");
        chunk_content = chunk.content;
        chunk_item_content = await marked.parse(chunk_content);
        chunk_item.dataset.content = chunk.content;
        chunk_item.getElementsByClassName('chunk-content')[0].innerHTML = chunk_item_content;

        if (!State.react_statu || chunk?.is_plugin) {
          (chunk_item.getElementsByClassName('chunk-actions')[0] as HTMLElement).style.display = "none";
        }
        chunk_item.getElementsByClassName('chunk-delete')[0].addEventListener("click", () => {
          toggleContextMessage(context_id);
        });
        chunk_item.getElementsByClassName('chunk-location')[0].addEventListener("click", () => {
          locateContextMessage(context_id);
        });
        chunk_item.getElementsByClassName('chunk-quote')[0].addEventListener("click", () => {
          quoteContextMessage(context_id);
        });
        message_content.appendChild(chunk_item);
      }
      message_content.dataset.content = (message_content.dataset.content || '') + chunk.content;
    }
    if (chunk.end) {
      if (State.seconds_timer) {
        clearInterval(State.seconds_timer);
        State.seconds_timer = null;
      }
      const thinking = messageSystem.getElementsByClassName("thinking")[0];
      thinking.classList.add('hidden');
      if (!messageSystem.dataset?.event_stop) {
        messageSystem.dataset.event_stop = "true";
        menuEvent(messageSystem, message_content, chunk?.is_plugin);
      }
    }
  }
  return messageSystem;
}

export async function startAgentLoop(data: any) {
  DOM.pause.style.display = "none";
  DOM.pause.innerHTML = "";
  const optionDom = document.querySelector('.base-container');
  if (optionDom) optionDom.remove();

  if (State.seconds_timer) clearInterval(State.seconds_timer);
  State.seconds_timer = setInterval(() => {
    State.chat.seconds += 0.1;
    DOM.seconds.innerText = State.chat.seconds.toFixed(1);
    if (State.chat.version && DOM.version) DOM.version.innerText = State.chat.version;
  }, 100);

  DOM.tokens.innerText = State.chat.tokens.toString();
  DOM.version.innerText = data.version;
  data.prompt = DOM.system_prompt.value;
  DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
}
