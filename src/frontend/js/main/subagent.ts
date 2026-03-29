import { userData, infoData, streamData, toolData } from './chat';

const State = {
    scroll_top: {
        info: true,
        data: true,
    },
};

let info: Record<string, any> = {
    id: null,
    name: null
}

const DOM = {
    messages: document.getElementById("messages") as HTMLElement,
    infoName: document.getElementById("info-name") as HTMLElement,
    minimizeBtn: document.getElementById('minimize-btn') as HTMLElement,
    closeBtn: document.getElementById("close-btn") as HTMLElement,
    top_div: document.getElementById("top_div") as HTMLElement,
}


document.addEventListener("DOMContentLoaded", () => {
    // Scroll Top
    DOM.top_div.addEventListener("mouseenter", () => {
        State.scroll_top.info = false;
        State.scroll_top.data = false;
    });
    DOM.top_div.addEventListener("mouseleave", () => {
        State.scroll_top.info = true;
        State.scroll_top.data = true;
    });
});

window.electronAPI.streamData((chunk) => {
    streamData(chunk).then((_) => {
        if (State.scroll_top.data)
            DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
    });
});

window.electronAPI.toolData((chunk) => toolData(chunk));

window.electronAPI.infoData((info) => {
    infoData(info).then(info_content => {
        if (State.scroll_top.info && info_content)
            info_content.scrollTop = info_content?.scrollHeight;
    });
});

window.electronAPI.userData((data) => {
    userData(DOM.messages, data).then(messageSystem => {
        const thinking = messageSystem?.getElementsByClassName("thinking")[0];
        thinking.classList.remove('hidden');
        const btn = messageSystem?.getElementsByClassName("btn")[0];
        btn.remove();
        if (State.scroll_top.data)
            DOM.top_div.scrollTop = DOM.top_div.scrollHeight;
    })
});

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