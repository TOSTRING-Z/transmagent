const { utils, inner, global } = require('../modules/globals')
const { LLMService } = require('./llm_service');
const JSON5 = require("json5");

String.prototype.format = function (data) {
    if (this) {
        let format_text = this.replaceAll("{{", "@bracket_left").replaceAll("}}", "@bracket_right");
        format_text = format_text.replace(/\{(.*?)\}/g, (match, cmd) => {
            try {
                return data[cmd.trim()] !== undefined ? data[cmd.trim()] : match;
            } catch (e) {
                console.log(e);
                return match;
            }
        });
        format_text = format_text.replaceAll("@bracket_left", "{").replaceAll("@bracket_right", "}")
        return format_text;
    } else {
        return this
    }
}

const State = {
    IDLE: 'idle',
    RUNNING: 'running',
    PAUSE: 'pause',
    FINAL: 'final',
    ERROR: 'error',
};

class ReActAgent {
    constructor(plugins, llm_service, window = {
        webContents: {
            send: (channel, data) => {
                const timestamp = new Date().toLocaleTimeString();
                console.log("%c[time]" + timestamp + " Channel: " + channel + ", Data:", "color: blue; font-weight: bold", data);
            }
        }
    }, alertWindow = {
        create: (content) => {
            const timestamp = new Date().toLocaleTimeString();
            console.log("%c[time]" + timestamp + " AlertWindow Content:", "color: green; font-weight: bold", content);
        }
    }) {
        this.state = State.IDLE;
        this.plugins = plugins;
        this.llm_service = llm_service;
        this.window = window;
        this.llm_service.window = window;
        this.alertWindow = alertWindow;
    }

    changeWindow(window = {
        webContents: {
            send: (channel, data) => {
                const timestamp = new Date().toLocaleTimeString();
                console.log("%c[time]" + timestamp + " Channel: " + channel + ", Data:", "color: blue; font-weight: bold", data);
            }
        }
    }) {
        this.window = window;
        this.llm_service.window = window;
    }

    setHistory(chat = null) {
        if (!chat) {
            chat = this.llm_service.chat;
        }

        if (chat.id) {
            // 保存当前聊天记录到历史记录
            if (chat.tokens == null) {
                chat.tokens = 0;
            }
            if (chat.seconds == null) {
                chat.seconds = 0;
            }
            let history_data = utils.getHistoryData();
            let history_exist = history_data.data.filter(history_ => history_.id == chat.id);
            if (history_exist.length == 0) {
                const history = chat
                history_data.data.push(history)
                utils.setHistoryData(history_data);
            } else {
                history_data.data = history_data.data.map(history_ => {
                    if (history_.id == chat.id) {
                        history_ = chat
                    }
                    return history_;
                });
                utils.setHistoryData(history_data);
            }
            const history_path = utils.getHistoryPath(chat.id);
            this.llm_service.saveMessages(history_path);
        }
    }

    delHistory(id) {
        let history_data = utils.getHistoryData();
        history_data.data = history_data.data.filter(history => history.id != id);
        utils.setHistoryData(history_data);
    }

    renameHistory(chat) {
        if (this.llm_service.chat.id == chat.id) {
            this.llm_service.chat.name = chat.name;
        }
        let history_data = utils.getHistoryData();
        history_data.data = history_data.data.map(history => {
            if (history.id == chat.id) {
                history.name = chat.name;
            }
            return history;
        });
        utils.setHistoryData(history_data);
    }

    async retry(func, data) {
        if (Object.prototype.hasOwnProperty.call(data, "output_format")) {
            data.input = data.output_format;
        } else {
            data.input = data.query;
        }
        if (Object.prototype.hasOwnProperty.call(data, "prompt_format")) {
            data.system_prompt = data.prompt_format;
        } else {
            data.system_prompt = data.prompt;
        }
        if (data.input_template) {
            data.input = data.input_template.format(data);
        }
        let retry_time = utils.getConfig("retry_time");
        let count = 0;
        while (count < retry_time) {
            if (this.llm_service.stop) {
                return null;
            }
            try {
                let output = await func(data);
                if (output) {
                    return output;
                }
                else {
                    count++;
                    await utils.delay(2);
                }
            } catch {
                count++;
                await utils.delay(2);
            }
        }
        return null;
    }

    async llmCall(data) {
        data.api_url = data.api_url || utils.getConfig("models")[data.model].api_url;
        data.api_key = data.api_key || utils.getConfig("models")[data.model]?.api_key;
        data.params = data.params || utils.getConfig("models")[data.model].versions.find(version => {
            return typeof version !== "string" && version.version === data.version;
        });
        if (data.params?.llm_params && Object.keys(data.params?.llm_params).length > 0)
            data.llm_params = data.params.llm_params;
        if (data.prompt_template)
            data.prompt_format = data.prompt_template.format(data);
        else
            data.prompt_format = data.prompt

        const func = (data) => {
            return this.llm_service.chatBase(data);
        }

        await this.retry(func, data);
        if (!data.output) {
            return null;
        }
        data.outputs.push(utils.copy(data.output));
        if (data.output_template) {
            data.output_format = data.output_template.format(data);
        } else {
            data.output_format = data.output;
        }
        data.output_formats.push(utils.copy(data.output_format));
        return data.output_format;
    }

    async sendData(data) {
        let agent_messages = this.llm_service.getMessages(true).filter(message => message.id === data.id);
        utils.sendData(inner.url_base.data.collection, {
            "chat_id": this.llm_service.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        })
        return true;
    }

    getDataDefault(cdata = {}) {
        let data = utils.copy(cdata);
        let defaults = {
            prompt: data?.prompt,
            query: data?.query,
            img_url: data?.img_url,
            file_path: data?.file_path,
            model: utils.copy(data?.model || global.model),
            version: utils.copy(data?.version || global.version),
            output_template: null,
            input_template: null,
            prompt_template: null,
            params: null,
            llm_params: utils.getConfig("llm_params"),
            memory_length: utils.getConfig("memory_length"),
            push_message: true,
            end: null,
            event: this.window?.webContents,
            outputs: [],
            output_formats: []
        }
        data = { ...defaults, ...data }
        return data;
    }

    async contextAutoOpt(data) {
        const auto_optimization = this.plugins.getTool(utils.getConfig('default')['auto_optimization'])?.func;
        const messages = this.llm_service.getMessages(true);
        let ids = { 'ids': [], 'context_ids': [] };
        for (const key in messages) {
            if (this.llm_service.stop) {
                this.window?.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true });
                break;
            }
            if (Object.hasOwnProperty.call(messages, key)) {
                let history, name, content;
                const message = messages[key];
                const content_json = utils.extractJson(message.content)
                if (content_json) content = JSON5.parse(content_json);
                if (message.role === 'user' && message.react === false) {
                    history = message.content;
                    name = 'ids';
                }
                else if (content && Object.hasOwnProperty.call(content, 'thinking')) {
                    history = content['thinking'];
                    name = 'context_ids'
                }
                if (history) {
                    const pred = await auto_optimization({ query: data.query, history });
                    if (pred === null) {
                        this.window?.webContents.send('log', 'Error in loading context automatic optimization model!');
                        break;
                    }
                    if (pred === 0) {
                        const messages_by_id = messages.filter(msg => msg.id === message.id && msg.context_id === message.context_id);
                        messages_by_id.forEach(msg => {
                            msg.del = true;
                        });
                        if (name === 'ids') {
                            ids[name].push(message.id);
                        } else {
                            ids[name].push(message.context_id);
                        }
                    } else {
                        const messages_by_id = messages.filter(msg => msg.id === message.id && msg.context_id === message.context_id);
                        messages_by_id.forEach(msg => {
                            if (msg?.del)
                                delete msg.del;
                        });
                    }
                }
            }
        }
        ids['ids'] = [...new Set(ids['ids'])];
        ids['context_ids'] = [...new Set(ids['context_ids'])];
        this.window?.webContents.send('delete-memory', ids);
    }

    async compression_message({ id }) {
        try {
            const will_compress_messages = this.llm_service.getMessages().filter(message => message.id == id);
            if (will_compress_messages.length > 0) {
                // 将所有同 id 的消息合并成一段文本，然后一次性交由大模型压缩为一条记录
                const llm_service = new LLMService();
                const react_agent = new ReActAgent(this.plugins, llm_service);
                let combined_content = will_compress_messages.map(msg => msg.content).join("\n\n");
                const prompt = `You are an intelligent assistant skilled at compressing and summarizing contextual content into detailed documents. Please ensure the generated documents are comprehensive and clear, accurately reflecting the original content.`;
                const query = `# context
                \`\`\`text
                ${combined_content}
                \`\`\`
                Please compress the above context into a detailed document. 
                Requirements: use concise language while retaining all essential information.
                please generate the compressed document:`;
                const data = react_agent.getDataDefault({ prompt, query, params: { ...utils.getConfig("llm_params"), temperature: 0.3 } });
                let result = await react_agent.llmCall(data);
                if (result) {
                    result = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + result.trim();
                    // 保留第一条 user 消息，生成一条压缩后的 assistant 记录并插入在其后
                    const firstMsg = will_compress_messages[0];
                    const preservedUser = will_compress_messages.find(m => m.role === 'user');

                    const compressed_message = {
                        ...firstMsg,
                        content: result,
                        role: "assistant",
                        react: false,
                        context_id: preservedUser?.context_id ?? firstMsg.context_id
                    };

                    // 从全量消息中移除所有相同 id 的消息，但保留第一条 user 消息（如果存在），并在其后插入压缩记录
                    let allMessages = this.llm_service.messages || this.llm_service.getMessages();
                    const originalFirstIndex = allMessages.findIndex(m => m.id == id);

                    const newMessages = [];
                    let keptUser = false;
                    for (let i = 0; i < allMessages.length; i++) {
                        const m = allMessages[i];
                        if (m.id != id) {
                            newMessages.push(m);
                        } else {
                            if (!keptUser && m.role === 'user') {
                                newMessages.push(m);
                                keptUser = true;
                            }
                            // 其他同 id 的消息跳过（即被压缩/移除）
                        }
                    }

                    if (keptUser) {
                        // 将压缩后的记录插入到保留的 user 消息之后
                        const insertPos = newMessages.findIndex(m => m.id == id && m.role === 'user');
                        newMessages.splice(insertPos + 1, 0, compressed_message);
                    } else {
                        // 回退：在原先第一条出现的位置插入压缩记录
                        const insertPos = originalFirstIndex === -1 ? newMessages.length : originalFirstIndex;
                        newMessages.splice(insertPos, 0, compressed_message);
                    }

                    this.llm_service.messages = newMessages;

                    console.log(`Compression success for id: ${id}`);
                    return result;
                }
            }
        } catch (error) {
            console.log(`Compression failed for id: ${id}, Error: ${error}`);
            return null;
        }
    }

    async setChatName(_data) {
        if (_data?.is_plugin) {
            // 如果是插件调用
            this.llm_service.chat.name = utils.formatDate();
        } else {
            // 调用大模型自动生成聊天名称
            const llm_service = new LLMService();
            const react_agent = new ReActAgent(this.plugins, llm_service);
            const user_content = this.llm_service.messages.find(message => message?.role === "user")?.content;
            const history_content = this.llm_service.messages.filter(message => message?.role === "assistant")?.map(message => utils.parseJsonContent(message.content)?.thinking || "").join("===");
            const prompt = `You are an intelligent assistant skilled at generating short chat names based on contextual content. Please ensure the generated names are concise and clear, accurately reflecting the chat content.`;
            const query = `# history
            \`\`\`text
            # user
            ${user_content}

            # assistant
            ${history_content}
            \`\`\`

            Generate a short ${_data?.language || utils.getLanguage()} chat name based on context. 
            Return name only (strictly no JSON/XML/formatting). 
            Requirements: max 20 chars, must contain letters, no pure numbers/symbols/spaces.
            please generate a name:`;
            const data = react_agent.getDataDefault({ prompt, query, params: { ...utils.getConfig("llm_params"), ..._data.params } });
            const result = await react_agent.llmCall(data);
            if (result) {
                this.llm_service.chat.name = result.split("\n")[0];
            }
        }
    }

    newChat() {
        this.window.webContents.send('clear');
        this.llm_service.init();
        this.setHistory(this.llm_service.chat);
        let chat = utils.copy(this.llm_service.chat);
        chat.name = utils.formatDate();
        return chat;
    }

    loadChat(id) {
        const history_path = utils.getHistoryPath(id);
        const max_index = this.load_message(history_path);
        const history_data = utils.getHistoryData();
        const history = history_data.data.find(history_ => history_.id == id);
        this.llm_service.chat = this.llm_service.getChatInit({ ...history, max_index: max_index });
        return this.llm_service.chat;
    }

    load_message(filePath) {
        let max_index = 0;
        this.window.webContents.send('clear');
        let messages = this.llm_service.loadMessages(filePath)
        
        if (messages.length > 0) {
            // 1. 恢复最大 ID
            const maxId = messages.reduce((max, current) => {
                return parseInt(current.id) > parseInt(max.id) ? current : max;
            }, messages[0]);

            if (maxId.id) {
                max_index = parseInt(maxId.id);
                const react = messages.find(message => message.react);
                
                // 2. 恢复 context_id
                if (react) {
                    const maxMemoryId = messages.reduce((max, current) => {
                        return parseInt(current.context_id) > parseInt(max.context_id) ? current : max;
                    }, messages[0]);
                    this.context_id = maxMemoryId.context_id;
                }

                // 3. 遍历并回放消息
                for (let i in messages) {
                    i = parseInt(i);
                    if (Object.hasOwnProperty.call(messages, i)) {
                        let { role, content, id, context_id, react, del } = messages[i];

                        // --- Case A: User (通常包含工具的 Observation 结果) ---
                        if (role == "user") {
                            if (react) {
                                // 注意：Observation 仍然以 JSON 对象存储在历史记录中
                                const tool_info = utils.parseJsonContent(content);
                                if (tool_info) {
                                    const tool = tool_info?.tool_call;
                                    const observation = tool_info?.observation;

                                    // 根据工具类型回放流式数据
                                    switch (tool) {
                                        case "display_file":
                                            this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: `${observation}\n\n`, end: true, del: del });
                                            break;
                                        case "add_subtasks":
                                        case "record_subtasks": // 兼容新旧名称
                                        case "complete_subtasks":
                                            // 结果保持 JSON 展示比较易读
                                            this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: `\`\`\`json\n${JSON.stringify(observation, null, 2)}\n\`\`\`\n\n`, end: true, del: del });
                                            break;
                                        default:
                                            break;
                                    }
                                    
                                    // 回放通用工具输出
                                    if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer", "cli_execute", "python_execute", "enter_idle_state"].includes(tool)) {
                                        // this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: `${observation}\n\n`, end: true, del: del });
                                    }
                                    
                                    // 回放交互式问题
                                    if (["ask_followup_question", "waiting_feedback", "plan_mode_response"].includes(tool)) {
                                        this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: `${observation.question || observation}\n\n`, end: true, del: del });
                                    }
                                }
                                
                                // Info Panel 显示：用户侧仍是 JSON 数据
                                let content_format = content.replaceAll("\\`", "'").replaceAll("`", "'");
                                this.window.webContents.send('info-data', { id: id, context_id: context_id, content: `Step ${i}, id: ${id}, context_id: ${context_id}, Output:\n\n\`\`\`json\n${content_format}\n\`\`\`\n\n`, del: del });
                            }
                            else {
                                // 普通用户对话
                                this.window.webContents.send('user-data', { id: id, context_id: context_id, content: content, del: del });
                            }
                        } 
                        // --- Case B: Assistant (XML 格式的 Thinking 和 Tool Call) ---
                        else {
                            if (react) {
                                try {
                                    // === XML 解析逻辑 ===
                                    // 1. 提取 Thinking
                                    const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
                                    const thinkingContent = thinkingMatch ? thinkingMatch[1].trim() : "";
                                    
                                    // 2. 提取 Tool Name
                                    const toolCallMatch = content.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
                                    let toolName = "";
                                    if (toolCallMatch) {
                                        const nameMatch = toolCallMatch[1].match(/<name>([\s\S]*?)<\/name>/i);
                                        if (nameMatch) toolName = nameMatch[1].trim();
                                    }

                                    // 3. 构建显示用的 Thinking
                                    // 如果没有 thinking 标签但有工具，显示工具名作为 fallback
                                    const displayThinking = `${thinkingContent || (toolName ? `Tool call: ${toolName}` : "")}\n\n---\n\n`;

                                    // 4. Info Panel 显示：改为 XML 格式
                                    let content_format = content.replaceAll("\\`", "'").replaceAll("`", "'"); // 防止 markdown 破坏
                                    this.window.webContents.send('info-data', { id: id, context_id: context_id, content: `Step ${i}, id: ${id}, context_id: ${context_id}, Output:\n\n\`\`\`xml\n${content_format}\n\`\`\`\n\n`, del: del });
                                    
                                    // 5. Stream Data 回放 Thinking
                                    this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: displayThinking, end: true, del: del });

                                    // 6. 特殊处理 enter_idle_state (从 observation 中提取 final_answer)
                                    if (toolName === "enter_idle_state") {
                                        // 对于 enter_idle_state，observation 就是 final_answer 字符串
                                        // 已经在 Case A 中通过 tool_info.observation 获取了
                                        // 这里不需要额外处理，因为 observation 会在 Case A 中作为工具输出回放
                                    } else if (!toolName && !thinkingContent) {
                                        // 如果既不是 XML 也没有 thinking，可能是普通文本回复
                                        this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: content, end: true, del: del });
                                    }
                                } catch (e) {
                                    console.error("Load message parse error:", e);
                                    this.window.webContents.send('stream-data', { id: id, context_id: context_id, content: "", end: true, del: del });
                                    continue;
                                }
                            } else {
                                // 普通 Assistant 对话 (非 ReAct 模式)
                                this.window.webContents.send('stream-data', { id: id, content: content, end: true, del: del });
                            }
                        }
                    }
                }
                console.log(`Load success: ${filePath}`)
            } else {
                console.log(`Load failed: ${filePath}`)
            }
        }
        return max_index;
    }

    get_info(data) {
        const output_format = utils.copy(data.output_format);
        data.output_format = data.output_format?.replaceAll("\\`", "'").replaceAll("`", "'");
        let info = utils.getConfig("info_template").format(data);
        data.output_format = output_format;
        console.log(info);
        return info;
    }

    // 抽象方法
    async step() {
        throw new Error("Method 'step()' must be implemented.");
    }


}

module.exports = {
    ReActAgent, State
};