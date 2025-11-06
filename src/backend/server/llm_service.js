const fs = require("fs");
const path = require("path");
const { streamJSON, streamSse } = require("./stream.js");
const JSON5 = require("json5");
const { utils } = require('../modules/globals.js')

String.prototype.format = function (data) {
    let format_text = this.replace(/(\{.*?\})/g, (match) => {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            return new Function(...keys, `return \`$${match}\`;`)(...values);
        } catch (e) {
            console.log(e);
            return match;
        }
    });
    return format_text;
}

class LLMService {
    constructor(messages = [], window = null) {
        this.window = window;
        this.init(messages);
    }

    init(messages = [], chat = {}) {
        this.messages = messages;
        this.stop = false;
        this.tag_success = false;
        this.chat = this.getChatInit(chat);
    }

    getMessages(all = true) {
        if (all) return this.messages;
        return this.messages.filter(message => !message?.del);
    }

    pushMessage(role, content, id, memory_id, show = true, react = true) {
        let message = { role: role, content: content, id: id, memory_id: memory_id, show: show, react: react };
        this.messages.push(message);
    }

    popMessage(id, memory_id) {
        if (this.messages.length > 0) {
            if (!id && !memory_id)
                return this.messages.pop();
            else {
                this.messages = this.messages.filter(message => {
                    if (message.id === id || message.memory_id === memory_id)
                        return false;
                    return true;
                })
            }
        } else {
            return null;
        }
    }

    envMessage(content) {
        return { role: "user", content: content };
    }

    getChatId() {
        //返回chat-UUID
        const uuid = crypto.randomUUID();
        return `chat-${uuid}`;
    }

    getChatInit(params = {}) {
        return {
            id: this.getChatId(),
            name: null,
            system_prompt: null,
            max_index: 0,
            mode: "act",
            tokens: 0,
            seconds: 0,
            envs: {},
            vars: {
                task_id: 0,
                tasks: {
                },
                subtask_id: 0,
            },
            ...params
        }
    }

    saveMessages(filePath) {
        try {
            if (!fs.existsSync(path.dirname(filePath))) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            }

            fs.writeFile(filePath, JSON.stringify(this.messages.map(message => {
                if (!message?.memory_id && message.role == "assistant") {
                    message.memory_id = message.id;
                }
                return message;
            }), null, 2), err => {
                if (err) {
                    console.log(err.message);
                    return;
                }
                console.log(`Save success: ${filePath}`);
            });
        } catch (error) {
            console.log(error)
        }
    }

    loadMessages(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return [];
            }
            const data = fs.readFileSync(filePath, "utf-8");
            this.messages = utils.parseJsonContent(data) || [];
            return this.messages.filter(message => message.show);
        } catch (error) {
            console.log(error);
            return false;
        }
    }

    toggleMessage({ id, del, del_mode }) {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.id != id);
            }
            else {
                this.messages = this.messages.map(message => {
                    if (message.id == id) {
                        message.del = del;
                    }
                    return message;
                });
            }
            return this.messages.length;
        } catch {
            return 0;
        }
    }

    thumbMessage({ id, thumb }) {
        try {
            const message_id = parseInt(id);
            if (thumb === 0) {
                return {
                    type: "thumb",
                    data: this.messages.find(message => message.id === message_id)?.thumb || 0
                }

            } else {
                this.messages = this.messages.map(message => {
                    if (message.id === message_id) {
                        // 1:up 0:null -1:down
                        message.thumb = thumb;
                    }
                    return message;
                });
                return {
                    type: "messages",
                    data: this.messages.filter(message => message.id === message_id)
                };
            }
        } catch {
            return null;
        }
    }

    toggleMemory({ memory_id, del_mode }) {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.memory_id != memory_id);
            }
            else {
                this.messages = this.messages.map(message => {
                    if (message.memory_id == memory_id) {
                        message.del = Object.prototype.hasOwnProperty.call(message, "del") ? !message.del : true;
                    }
                    return message;
                });
            }
            return this.messages.length;
        } catch {
            return 0;
        }
    }

    stopMessage() {
        this.stop = true;
    }

    startMessage() {
        this.stop = false;
    }

    // 仅仅保留部分思考和调用工具名
    delMessage(message, truncateThinking = false) {
        let message_copy = utils.copy(message);
        const content_parse = utils.parseJsonContent(message_copy.content);
        if (content_parse) {
            if (content_parse?.observation && message_copy.role === "user") {
                message_copy.content = `Assistant called ${content_parse.tool_call} tool...[User deleted this record]`;
            }
            if (message_copy.role === "assistant") {
                content_parse.params = "[User deleted this record]";
                if (truncateThinking && typeof content_parse.thinking === 'string' && content_parse.thinking.length > 50) {
                    content_parse.thinking = content_parse.thinking.slice(0, 50) + "…[User deleted this record]";
                }
                message_copy.content = JSON.stringify(content_parse);
            }
        }
        return message_copy;
    }

    formatMessages(messages_list, params, env_message = null) {
        params = params ? params : {};
        // 遍历 messages_list 数组，并删除每个对象的 id 属性
        messages_list = messages_list.map(message => {
            let message_copy = utils.copy(message);
            if (message_copy.del) {
                message_copy = this.delMessage(message_copy);
            }
            delete message_copy.id;
            delete message_copy.memory_id;
            delete message_copy.show;
            delete message_copy.react;
            delete message_copy.del;
            delete message_copy.thumb;
            return message_copy;
        });

        // 判断是否是视觉模型
        if (!Object.prototype.hasOwnProperty.call(params, "vision")) {
            messages_list = messages_list.filter(message => {
                if (typeof message.content !== "string") {
                    return false;
                }
                return true;
            })
        }
        else {
            messages_list = messages_list.filter(message => {
                if (typeof message.content !== "string") {
                    switch (message.content[1].type) {
                        case "image_url":
                            return params.vision.includes("image")
                        case "video_url":
                            return params.vision.includes("video")
                        default:
                            return false;
                    }
                }
                return true;
            })
        }

        // ollama
        if (params?.ollama) {
            messages_list = messages_list.map(message => {
                if (typeof message.content !== "string") {
                    const image = message.content[1].image_url.url.split(",")[1];
                    const content = message.content[0].text;
                    const role = message.role;
                    return {
                        role: role,
                        content: content,
                        images: [image]
                    }
                } else {
                    return message;
                }
            })
        }

        if (env_message) {
            messages_list.push(env_message);
        }

        return messages_list;

    }

    setTag(tag) {
        this.tag_success = tag;
    }

    getMemory(data) {
        let messages_success = utils.copy(this.getMessages(false));
        if (this.tag_success) {
            messages_success = messages_success.map(message => {
                let content_parse = utils.parseJsonContent(message.content);
                if (content_parse?.tool_call == "cli_execute" && message.role == "user") {
                    if (content_parse.tool_call == "cli_execute") {
                        let success = true;
                        if (Object.prototype.hasOwnProperty.call(content_parse.observation, "success"))
                            success = content_parse.observation?.success
                        else {
                            let observation_json = utils.extractJson(content_parse.observation);
                            if (observation_json)
                                success = JSON5.parse(observation_json).success;
                            else
                                success = true;
                        }
                        if (!success) {
                            message.content == `Assistant called ${content_parse.tool_call} tool: Error occurred!`;
                        }
                    }
                } else {
                    if (content_parse?.error) {
                        message.content == `Assistant called ${content_parse.tool_call} tool: Error occurred!`;
                    }
                }
                return message;
            })
        }
        let messages_list = messages_success.slice(Math.max(messages_success.length - data.memory_length, 0), messages_success.length);
        return messages_list;
    }

    async chatBase(data) {
        try {
            let content = data.input;
            if (data?.img_url) {
                content = [
                    {
                        "type": "text",
                        "text": data.input
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data.img_url
                        }
                    }
                ];
            }
            let messages_list = null;
            let message_input = null;
            if (data.system_prompt) {
                messages_list = [{ role: "system", content: data.system_prompt, id: data.id, memory_id: null, show: true, react: false }]
                messages_list = messages_list.concat(this.getMemory(data))
            }
            else {
                messages_list = this.getMemory(data)
            }
            if (data?.push_message) {
                message_input = { role: "user", content: content, id: data.id, memory_id: null, show: true, react: false };
                messages_list.push(message_input)
            }
            let message_output = { role: 'assistant', content: '', id: data.id, memory_id: null, show: true, react: false }

            let body = {
                model: data.version,
                messages: this.formatMessages(messages_list, data.params, data?.env_message),
                ...data.llm_params
            }

            let headers = {
                "Content-Type": "application/json"
            }
            if (data?.api_key) {
                headers["Authorization"] = `Bearer ${data.api_key}`;
            }
            if (this.stop) {
                this.stop = false;
                return "The user interrupted the task.";
            }
            if (body?.stream) {
                const resp = await fetch(new URL(data.api_url), {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify(body),
                });
                const contentType = resp.headers.get('content-type');
                let stream_res;
                if (contentType && contentType.includes('text/event-stream')) {
                    stream_res = streamSse(resp);
                }
                else {
                    stream_res = streamJSON(resp);
                }

                for await (const chunk of stream_res) {
                    if (this.stop) {
                        return "The user interrupted the task.";
                    }
                    content = "";
                    if (Object.prototype.hasOwnProperty.call(chunk, "message")) {
                        content = chunk.message.content;
                        message_output.content += content;
                    } else {
                        let delta = chunk.choices[0]?.delta;
                        if (chunk.choices.length > 0 && delta) {
                            if (Object.prototype.hasOwnProperty.call(delta, "reasoning_content") && delta.reasoning_content)
                                content = delta.reasoning_content;
                            else if (Object.prototype.hasOwnProperty.call(delta, "content") && delta.content) {
                                content = delta.content;
                                message_output.content += content;
                            }
                        }
                    }
                    if (!data?.react && !data?.return_response) {
                        this.window.webContents.send('stream-data', { id: data.id, content: content, end: false });
                    }
                }
                data.output = message_output.content;
            } else {
                body.stream = false;
                const resp = await fetch(new URL(data.api_url), {
                    method: "POST",
                    headers: headers,
                    body: JSON.stringify(body),
                });
                let respJson = await resp.json();
                if (Object.prototype.hasOwnProperty.call(respJson, "error") && !data?.return_response) {
                    this.window.webContents.send('info-data', { id: data.id, content: `POST Error:\n\n\`\`\`\n${respJson.error?.message}\n\`\`\`\n\n` });
                    return null;
                }
                if (Object.prototype.hasOwnProperty.call(respJson, "message")) {
                    data.output = respJson.message.content;
                } else {
                    data.output = respJson.choices[0].message.content;
                }
                if (!data?.react && !data?.return_response) {
                    this.window.webContents.send('stream-data', { id: data.id, content: data.output, end: false });
                }
                message_output.content = data.output;
            }

            if (this.stop) {
                return "The user interrupted the task.";
            }

            if (data.end) {
                this.messages.push(message_input);
                this.messages.push(message_output);
                if (data?.return_response)
                    return true;
                if (!data?.react)
                    this.window.webContents.send('stream-data', { id: data.id, content: "", end: true });
                else
                    this.window.webContents.send('stream-data', { id: data.id, content: data.output_template ? data.output_template.format(data) : data.output, end: true });
                return true;
            } else {
                if (data?.push_message) {
                    this.messages.push(message_input);
                    this.messages.push(message_output);
                }
            }
            return data.output;
        } catch (error) {
            console.log(error)
            if (!data?.return_response)
                this.window.webContents.send('info-data', { id: data.id, content: `Response error: ${error.message}\n\n` });
            return null;
        }
    }
}

module.exports = {
    LLMService
};
