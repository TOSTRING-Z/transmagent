import { userData, infoData, streamData, toolData } from './chat';

let info: Record<string, any> = {
    id: null,
    name: null
}

const DOM = {
    messages: document.getElementById("messages") as HTMLElement,
    infoName: document.getElementById("info-name") as HTMLElement,
    minimizeBtn: document.getElementById('minimize-btn') as HTMLElement,
    closeBtn: document.getElementById("close-btn") as HTMLElement,
}

window.electronAPI.streamData((chunk) => streamData(chunk));

window.electronAPI.toolData((chunk) => toolData(chunk));

window.electronAPI.infoData((info) => infoData(info));

window.electronAPI.userData((data) => userData(DOM.messages, data).then(messageSystem => {
    const thinking = messageSystem?.getElementsByClassName("thinking")[0];
      thinking.classList.remove('hidden');
      const btn = messageSystem?.getElementsByClassName("btn")[0];
      btn.remove();
  }));

window.electronAPI.windowInfo((data) => {
    info = data;
    DOM.infoName.innerHTML = info.name;
})

DOM.minimizeBtn.addEventListener('click', () => {
    window.electronAPI.minimizeWindow(info);
})

DOM.closeBtn.addEventListener('click', () => {
    window.electronAPI.closeWindow(info);
})