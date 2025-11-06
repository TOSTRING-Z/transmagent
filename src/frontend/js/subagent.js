let global = {
    scroll_top: {
        info: true,
        data: true,
    },
    status: {
        auto_opt: false,
    },
};

const messages = document.getElementById("messages");
const top_div = document.getElementById("top_div");

let user_message = `<div class="relative space-y-2 space-x-2" data-role="user" data-id="">
  <div class="flex flex-row-reverse w-full">
    <div class="menu-container">
      <img class="menu user" src="img/user.svg" alt="User Avatar">
    </div>
    <div class="message"></div>
  </div>
</div>`;

let system_message = `<div class="relative space-y-2 space-x-2" data-role="system" data-id="">
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
  </div>
  <div class="message-actions">
    <i class="far fa-copy copy action-btn" title="copy"></i>
    <i class="fas fa-toggle-off toggle action-btn" title="toggle"></i>
  </div>
</div>`

async function userAdd(data) {
    let messageUser;
    if (typeof (data.content) == "string") {
        messageUser = await user_message.formatMessage({
            "id": data.id,
            "message": data.content,
            "image_url": data?.img_url,
        }, "user")
    } else {
        messageUser = await user_message.formatMessage({
            "id": data.id,
            "message": data.content[0].text.content,
            "image_url": data.content[1].image_url.url,
        }, "user");
    }
    messages.appendChild(messageUser);
    let messageSystem = await system_message.formatMessage({
        "icon": getIcon(false),
        "id": data.id,
        "message": ""
    }, "system");
    messages.appendChild(messageSystem);
}

async function infoAdd(info) {
    const messageSystem = document.querySelectorAll(`[data-id='${info.id}']`)[1];
    if (messageSystem) {
        const info_content = messageSystem.getElementsByClassName('info-content')[0];
        const info_div = messageSystem.getElementsByClassName('info')[0];
        if (info_div && info_div.classList.contains('hidden')) {
            info_div.classList.remove('hidden');
        }
        if (info.content) {
            let info_item_content = await marked.parse(info.content);
            let info_item = createElement(`<div info_data-id="${info.memory_id}">
    <div class="info-item">
    </div>
  </div>`);
            if (info?.del)
                info_item.classList.add("del");
            info_item.getElementsByClassName('info-item')[0].innerHTML = info_item_content;
            info_content.appendChild(info_item);
            info_content.dataset.content += info.content;
            if (global.scroll_top.info)
                info_content.scrollTop = info_content.scrollHeight;
            if (global.scroll_top.data)
                top_div.scrollTop = top_div.scrollHeight;
        }
    }
}


async function streamMessageAdd(chunk) {
    const messageSystem = document.querySelectorAll(`[data-id='${chunk.id}']`)[1];
    if (messageSystem) {
        const message_content = messageSystem.getElementsByClassName('message')[0];
        if (chunk.content) {
            let memory_id = Object.prototype.hasOwnProperty.call(chunk, "memory_id") ? chunk.memory_id : chunk.id;
            // console.log(`memory_id: ${memory_id}`)
            // console.log(`content: ${chunk.content}`)
            // console.log(`------------------------`)

            let chunk_content = null;
            let chunk_item_content = null;
            let chunk_item = null;
            let chunk_item_query = message_content.querySelectorAll(`[chunk_data-id='${memory_id}']`);
            if (chunk_item_query.length > 0) {
                chunk_content = chunk_item_query[0].dataset.content + chunk.content;
                chunk_item_content = await marked.parse(chunk_content);
                chunk_item = chunk_item_query[0];
                chunk_item.dataset.content = chunk_content;
                chunk_item.getElementsByClassName('chunk-content')[0].innerHTML = chunk_item_content;
            } else {
                chunk_item = createElement(`<div chunk_data-id="${memory_id}">
          <div class="chunk">
            <div class="chunk-content"></div>
          </div>
        </div>`);
                chunk_content = chunk.content;
                chunk_item_content = await marked.parse(chunk_content);
                chunk_item.dataset.content = chunk.content;
                chunk_item.getElementsByClassName('chunk-content')[0].innerHTML = chunk_item_content;
                message_content.appendChild(chunk_item);
            }
            message_content.dataset.content += chunk.content;
            if (global.scroll_top.data)
                top_div.scrollTop = top_div.scrollHeight;
        }
        if (chunk.end) {
            if (!messageSystem.dataset?.event_stop) {
                messageSystem.dataset.event_stop = true;
                const thinking = messageSystem.getElementsByClassName("thinking")[0];
                thinking.remove();
                menuEvent(messageSystem, message_content);
            }
            if (global.scroll_top.data)
                top_div.scrollTop = top_div.scrollHeight;
        }
    }
}


function menuEvent(messageSystem, message_content) {
    const copy = messageSystem.getElementsByClassName("copy")[0];
    const toggle = messageSystem.getElementsByClassName("toggle")[0];
    copy.classList.add("active");
    toggle.classList.add("active");
    copy.addEventListener("click", () => {
        const raw = message_content.dataset.content;
        navigator.clipboard.writeText(raw).then(() => {
            // showLog('success', 'Copy successful');
            console.log(raw);
        }).catch(err => {
            console.log(err);
        });
    })
    toggle.addEventListener("click", () => {
        messageSystem.classList.toggle("message_toggle");
    })
}


const { Marked } = globalThis.marked;
const { markedHighlight } = globalThis.markedHighlight;

document.addEventListener("DOMContentLoaded", () => {
    globalThis.mermaid.initialize({ startOnLoad: false });
});

const marked = new Marked(
    markedHighlight({
        async: true, // Add this line to enable async highlighting
        langPrefix: "hljs language-",
        async highlight(code, lang) {
            if (lang === 'mermaid') {
                // 创建一个ID
                const eleid = 'mermaid-' + Date.now() + '-' + Math.round(Math.random() * 1000)
                // 解析内容，判断 mermaid 的语法是否合法
                globalThis.mermaid.parse(code).then(syntax => {
                    if (syntax) {
                        setTimeout(async () => {
                            let element = document.getElementById(eleid);
                            const { svg } = await globalThis.mermaid.render(eleid + "-svg", code);
                            element.innerHTML = svg;
                        }, 1000);
                    }
                })
                    .catch(error => {
                        console.error('mermaid 格式校验失败:错误信息如下:\n', error);
                        let element = document.getElementById(eleid);
                        element.innerHTML = code;
                    })
                return `<div id="${eleid}">${code}</div>`;
            }
            let language = globalThis.hljs.getLanguage(lang) ? lang : 'plaintext';
            const hljsResult = await globalThis.hljs.highlight(code, { language });
            return hljsResult.value;
        }
    })
);

const marked_input = new Marked({
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
        },
    }
});


const formatCode = (token) => {
    let encodeCode;
    // Define regex to match ```<language>\n<code>\n``` block
    const codeBlockRegex = /```\w*\n([\s\S]*?)```/;
    // Execute matching
    const match = token.raw.match(codeBlockRegex);
    if (match) {
        // Extract code block content (remove language identifier)
        const codeContent = match[1].trim();
        encodeCode = encodeURIComponent(codeContent);
    } else {
        encodeCode = encodeURIComponent(token.raw);
    }
    return `<div class="code-container">
  <div class="code-header">
    <span class="language-tag">${token.type}</span>
    <button
    class="copy-btn"
    data-code="${encodeCode}"
    title="Copy code">Copy</button>
  </div>
  <pre class="hljs"><code>${token.text}</code></pre>
</div>`;
}

const formatText = (token) => {
    let language = globalThis.hljs.getLanguage(token.type) ? token.type : "plaintext";
    const highlightResult = globalThis.hljs.highlight(token.raw, { language }).value;
    return highlightResult;
}

const formatImage = (token) => {
    if (token.title === "pdf") {
        return token.text;
    }
    return `<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${token.href}" alt="${token.text}"></img>`;
}

const formatLink = (token) => {
    return token.href;
}

const renderer = {
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
    },
}

// 渲染 PDF
let totalTime = 0;
let timerInterval = null;

async function renderPDF(id) {
    totalTime = 0;
    timerInterval = setInterval(async () => {
        totalTime++;
        if (totalTime > 10) {
            clearInterval(timerInterval);
            timerInterval = null;
            return;
        }
        try {
            const container = document.getElementById(id);
            const pdfUrl = container.getAttribute('data-pdf');
            const canvas = container.querySelector('canvas');
            const pdf = await globalThis.pdfjsLib.getDocument(pdfUrl).promise;
            // 获取第一页
            const page = await pdf.getPage(1);
            const textContent = await page.getTextContent();
            console.log(textContent);
            const viewport = page.getViewport({ scale: 1 });
            const context = canvas.getContext('2d');

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport
            };

            await page.render(renderContext).promise;
            clearInterval(timerInterval);
            timerInterval = null;
            return;
        } catch (error) {
            console.log(error)
        }
    }, 500);
}

const walkTokens = async (token) => {
    if (token.type === 'image') {
        try {
            if (token.href.endsWith('.pdf')) {
                const id = `pdf-canvas-${Date.now()}`;
                let container = `<div class="pdf-container" id="${id}" data-pdf="@href">
            <canvas></canvas>
        </div>`.format(token);
                token.text = container.outerHTML;
                token.title = "pdf"
                renderPDF(id);
            }
        } catch {
            token.title = 'invalid';
        }
    }
};

const think = {
    name: 'think',
    level: 'block',
    start(src) { return src.match(/<think>/)?.index; },
    tokenizer(src) {
        const rule0 = /^<think>([\s\S]*?)<\/think>/;
        const match0 = rule0.exec(src);
        const rule1 = /^<think>([\s\S]*)/;
        const match1 = rule1.exec(src);
        const match = match0 || match1
        if (match) {
            const token = {
                type: "text",
                typeThink: true,
                raw: match[0],
                text: match[1],
            };
            return token
        }
    },
};

const options = {
    nonStandard: true,
    async: true
};

marked.use(globalThis.markedKatex(options));
marked.use({ walkTokens, renderer, async: true, extensions: [think] });


function createElement(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newElement = doc.body.firstChild;
    return newElement;
}

// Extend String prototype
String.prototype.formatMessage = async function (params, role) {
    const newElement = createElement(this);
    let message = newElement.getElementsByClassName("message")[0]
    if (Object.prototype.hasOwnProperty.call(params, "icon")) {
        let menu = newElement.getElementsByClassName("menu")[0]
        menu.src = `img/${params["icon"]}.svg`;
    }
    if (role === "system") {
        message.innerHTML = await marked.parse(params["message"])
    } else {
        if (params.image_url) {
            let img = createElement(`<img class="w-1/2 shadow-xl rounded-md mb-1 hover" src="${params.image_url}">`);
            message.appendChild(img);
        }
        let text = createElement(`<div class="message-text"></div>`);
        text.innerText = params["message"] || "";
        message.appendChild(text);
    }
    newElement.dataset.id = params["id"]
    return newElement;
};

String.prototype.format = function (params) {
    const formattedText = this.replace(/@(\w+)/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            return params[key];
        } else {
            console.warn(`Key "${key}" not found in params`);
            return match;
        }
    });
    const parser = new DOMParser();
    const doc = parser.parseFromString(formattedText, 'text/html');
    const newElement = doc.body.firstChild;
    return newElement;
};

function getIcon(is_plugin) {
    return is_plugin ? "api" : "ai";
}

// 窗口控制逻辑
const { ipcRenderer } = require('electron')

let info = {
    id: null,
    name: null
}

document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send(`minimize-window-${info.id}`)
})

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send(`close-window-${info.id}`)
})

ipcRenderer.on('window-info', (_event, data) => {
    info = data;
    document.getElementById("info-name").innerHTML = info.name;
})

ipcRenderer.on('stream-data', (_event, chunk) => {
    streamMessageAdd(chunk);
})

ipcRenderer.on('info-data', (_event, info) => {
    infoAdd(info);
})

ipcRenderer.on('user-data', (_event, data) => {
    userAdd(data);
})