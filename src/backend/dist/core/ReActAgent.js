"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReActAgent = exports.Mode = exports.State = void 0;
const json5_1 = __importDefault(require("json5"));
const logger_1 = require("../utils/logger");
const LLMService_1 = require("./LLMService");
const globals_1 = require("../utils/globals");
const AdapterFactory_1 = require("../factories/AdapterFactory");
var State;
(function (State) {
    State["IDLE"] = "idle";
    State["RUNNING"] = "running";
    State["PAUSE"] = "pause";
    State["FINAL"] = "final";
    State["ERROR"] = "error";
})(State || (exports.State = State = {}));
var Mode;
(function (Mode) {
    Mode["AUTO"] = "Automatic mode";
    Mode["ACT"] = "Execution mode";
    Mode["PLAN"] = "Planning mode";
    Mode["FLASH"] = "Flash mode";
})(Mode || (exports.Mode = Mode = {}));
// 模拟 Electron window 对象的默认结构
const createMockWindow = () => ({
    webContents: {
        send: (channel, data) => {
            // const timestamp = new Date().toLocaleTimeString();
            // logger.log(`%c[time]${timestamp} Channel: ${channel}, Data:`, "color: blue; font-weight: bold", data);
        }
    }
});
const createMockAlertWindow = () => ({
    create: (content) => {
        const timestamp = new Date().toLocaleTimeString();
        logger_1.logger.log(`%c[time]${timestamp} AlertWindow Content:`, "color: green; font-weight: bold", content);
    }
});
class ReActAgent {
    state;
    llm_service;
    window;
    alertWindow;
    context_id; // 用于记录当前的 memory id
    constructor(llm_service, window = createMockWindow(), alertWindow = createMockAlertWindow()) {
        this.state = State.IDLE;
        this.llm_service = llm_service;
        this.window = window;
        // 将窗口句柄注入到 llm_service（若 LLMService 中声明了 window 属性）
        this.llm_service.window = window;
        this.alertWindow = alertWindow;
    }
    // 安全的模板字符串格式化函数（替代被废弃的 String.prototype.format）
    formatTemplate(template, data) {
        if (!template)
            return "";
        let formatText = template.replaceAll("{{", "{").replaceAll("}}", "}");
        formatText = formatText.replace(/\{(.*?)\}/g, (match, cmd) => {
            try {
                const key = cmd.trim();
                return data[key] !== undefined ? data[key] : match;
            }
            catch (e) {
                console.error(e);
                return match;
            }
        });
        return formatText;
    }
    changeWindow(window = createMockWindow()) {
        this.window = window;
        this.llm_service.window = window;
    }
    setHistory(chat = null) {
        if (!chat) {
            chat = this.llm_service.chatManager.chat;
        }
        if (chat.id) {
            if (chat.tokens == null)
                chat.tokens = 0;
            if (chat.seconds == null)
                chat.seconds = 0;
            let history_data = globals_1.utils.getHistoryData();
            let history_exist = history_data.data.filter((h) => h.id === chat.id);
            let id_exist = history_exist.length > 0;
            if (!id_exist) {
                history_data.data.push(chat);
            }
            else {
                history_data.data = history_data.data.map((h) => h.id === chat.id ? chat : h);
            }
            globals_1.utils.setHistoryData(history_data);
            const history_path = globals_1.utils.getHistoryPath(chat.id);
            this.llm_service.chatManager.saveMessages(history_path);
            return id_exist;
        }
    }
    delHistory(id) {
        let history_data = globals_1.utils.getHistoryData();
        history_data.data = history_data.data.filter((h) => h.id !== id);
        globals_1.utils.setHistoryData(history_data);
    }
    renameHistory(chat) {
        if (this.llm_service.chatManager.chat.id === chat.id) {
            this.llm_service.chatManager.chat.name = chat.name;
        }
        let history_data = globals_1.utils.getHistoryData();
        history_data.data = history_data.data.map((h) => {
            if (h.id === chat.id)
                h.name = chat.name;
            return h;
        });
        globals_1.utils.setHistoryData(history_data);
    }
    async retry(func, data) {
        let retry_time = globals_1.utils.getConfig("retry_time") || 3;
        let count = 0;
        while (count < retry_time) {
            if (this.llm_service.stopFlag)
                return null;
            try {
                let output = await func(data);
                if (output)
                    return output;
                count++;
                await globals_1.utils.delay(2);
            }
            catch (err) {
                console.error("Retry Error:", err);
                count++;
                await globals_1.utils.delay(2);
            }
        }
        return null;
    }
    async llmCall(data) {
        const configModels = globals_1.utils.getConfig("models");
        data.api_url = data.api_url || configModels[data.model]?.api_url;
        data.api_key = data.api_key || configModels[data.model]?.api_key;
        data.params = data.params || configModels[data.model]?.versions?.find((v) => {
            return typeof v !== "string" && v.version === data.version;
        });
        if (data.params?.llm_params && Object.keys(data.params.llm_params).length > 0) {
            data.llm_params = data.params.llm_params;
        }
        data.prompt_format = data.prompt_template
            ? this.formatTemplate(data.prompt_template, data)
            : data.prompt;
        data.input = data.output_format ? data.output_format : data.query;
        data.system_prompt = data.prompt_format ? data.prompt_format : data.prompt;
        if (data.input_template) {
            data.input = this.formatTemplate(data.input_template, data);
        }
        const func = (reqData) => this.llm_service.chatBase(reqData);
        let baseResult = await this.retry(func, data);
        if (!baseResult)
            return null;
        data.outputs.push(globals_1.utils.copy(data.output));
        data.output_format = data.output_template
            ? this.formatTemplate(data.output_template, data)
            : data.output;
        data.output_formats.push(globals_1.utils.copy(data.output_format));
        return baseResult;
    }
    async sendData(data) {
        let agent_messages = this.llm_service.chatManager.getMessages(true).filter(m => m.group_id === data.id);
        globals_1.utils.sendData(globals_1.CONSTANTS.COLLECTION_URL, {
            "chat_id": this.llm_service.chatManager.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        });
        return true;
    }
    getDataDefault(cdata = {}) {
        let data = globals_1.utils.copy(cdata);
        let defaults = {
            prompt: data?.prompt,
            query: data?.query,
            img_url: data?.img_url,
            file_path: data?.file_path,
            api_url: null,
            api_key: null,
            model: this.llm_service.chatManager.chat.model,
            version: this.llm_service.chatManager.chat.version,
            is_plugin: this.llm_service.chatManager.chat.model === "plugins",
            output_template: null,
            input_template: null,
            prompt_template: null,
            params: null,
            llm_params: globals_1.utils.getConfig("llm_params"),
            memory_length: globals_1.utils.getConfig("memory_length"),
            push_message: true,
            end: null,
            event: this.window?.webContents,
            input: null,
            input_format: null,
            output: null,
            output_format: null,
            outputs: [],
            output_formats: []
        };
        return { ...defaults, ...data };
    }
    async compressionGroupMessage({ group_id }) {
        try {
            const will_compress_messages = this.llm_service.chatManager.getMessages().filter(m => m.group_id === group_id);
            if (will_compress_messages.length > 0) {
                const temp_llm_service = new LLMService_1.LLMService();
                const react_agent = new ReActAgent(temp_llm_service);
                let combined_content = will_compress_messages.map(msg => typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).join("\n\n");
                const prompt = `You are an intelligent assistant skilled at compressing and summarizing contextual content into detailed documents. Please ensure the generated documents are comprehensive and clear, accurately reflecting the original content.`;
                const query = `# context\n\`\`\`text\n${combined_content}\n\`\`\`\nPlease compress the above context into a detailed document. \nRequirements: use concise language while retaining all essential information.\nplease generate the compressed document:`;
                const data = react_agent.getDataDefault({
                    prompt, query, params: { ...globals_1.utils.getConfig("llm_params"), temperature: 0.3 }
                });
                let messageOutput = await react_agent.llmCall(data);
                if (messageOutput) {
                    let content = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + messageOutput.content.trim();
                    const firstMsg = will_compress_messages[0];
                    const preservedUser = will_compress_messages.find(m => m.role === 'user');
                    const compressed_message = {
                        ...firstMsg,
                        content: content,
                        role: "assistant",
                        react: false,
                        context_id: preservedUser?.context_id ?? firstMsg.context_id
                    };
                    let allMessages = this.llm_service.chatManager.getMessages(true);
                    const originalFirstIndex = allMessages.findIndex(m => m.group_id === group_id);
                    const newMessages = [];
                    let keptUser = false;
                    for (const m of allMessages) {
                        if (m.group_id !== group_id) {
                            newMessages.push(m);
                        }
                        else if (!keptUser && m.role === 'user') {
                            newMessages.push(m);
                            keptUser = true;
                        }
                    }
                    if (keptUser) {
                        const insertPos = newMessages.findIndex(m => m.group_id === group_id && m.role === 'user');
                        newMessages.splice(insertPos + 1, 0, compressed_message);
                    }
                    else {
                        const insertPos = originalFirstIndex === -1 ? newMessages.length : originalFirstIndex;
                        newMessages.splice(insertPos, 0, compressed_message);
                    }
                    this.llm_service.chatManager.messages = newMessages;
                    logger_1.logger.log(`Compression success for id: ${group_id}`);
                    return compressed_message.content;
                }
            }
        }
        catch (error) {
            logger_1.logger.log(`Compression failed for id: ${group_id}, Error: ${error}`);
        }
        return null;
    }
    async setChatName(_data) {
        if (_data?.is_plugin) {
            this.llm_service.chatManager.chat.name = globals_1.utils.formatDate();
            return;
        }
        const temp_llm_service = new LLMService_1.LLMService();
        temp_llm_service.chatManager.chat.tool_format = this.llm_service.chatManager.chat.tool_format; // 继承当前 chat 的工具格式
        const react_agent = new ReActAgent(temp_llm_service);
        // 1. 构建上下文
        const user_content = this.llm_service.chatManager.messages.find(m => m?.role === "user")?.content || "";
        const history_content = this.llm_service.chatManager.messages
            .filter(m => m?.role === "assistant")
            .map(m => globals_1.utils.parseJsonContent(m.content)?.thinking || "")
            .join("===");
        const prompt = `You are an intelligent assistant skilled at generating short chat names based on contextual content.`;
        const query = `# history\n\`\`\`text\n# user\n${user_content}\n\n# assistant\n${history_content}\n\`\`\`\n\nGenerate a short ${_data?.language || globals_1.utils.getLanguage()} chat name based on context...`;
        // 2. 发起请求
        const callData = react_agent.getDataDefault({
            prompt,
            query,
            model: _data.model,
            version: _data.version,
        });
        const messageOutput = await react_agent.llmCall(callData);
        if (messageOutput) {
            // 3. 使用适配器处理响应 (核心解耦点)
            const format = this.llm_service.chatManager.chat.tool_format;
            const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(format); // 获取对应的适配器实例
            const rawContent = adapter.extractText(messageOutput);
            const chatName = rawContent.split("\n")[0].trim();
            // 4. 设置结果
            this.llm_service.chatManager.chat.name = chatName || globals_1.utils.formatDate();
        }
    }
    newChat() {
        this.window.webContents.send('clear');
        this.initVar();
        this.llm_service.chatManager.init();
        this.setHistory(this.llm_service.chatManager.chat);
        return this.llm_service.chatManager.chat;
    }
    initVar() {
        logger_1.logger.log("可选实现");
    }
    loadChat(id) {
        this.initVar();
        const history_path = globals_1.utils.getHistoryPath(id);
        this.loadMessage(history_path);
        return this.llm_service.chatManager.chat;
    }
    loadMessage(filePath) {
        this.window.webContents.send('clear');
        let messages = this.llm_service.chatManager.loadMessages(filePath);
        if (messages.length > 0) {
            messages.forEach((message, i) => {
                let { role, content, group_id, context_id, react, del } = message;
                if (role === "user") {
                    this.window.webContents.send('userData', { group_id, context_id, content, del });
                }
                if (role === "tool") {
                    const tool_call_name = message.tool_call_name || "unknown_tool";
                    switch (tool_call_name) {
                        case "display_file":
                            this.window.webContents.send('streamData', { group_id, context_id, content: `${content}\n\n`, end: true, del });
                            break;
                        case "add_subtasks":
                        case "complete_subtasks":
                            this.window.webContents.send('streamData', { group_id, context_id, content: `\`\`\`json\n${content}\n\`\`\`\n\n`, end: true, del });
                            break;
                    }
                    if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_call_name)) {
                        this.window.webContents.send('streamData', { group_id, context_id, content: `${content}\n\n`, end: true, del });
                    }
                    if (["ask_followup_question", "waiting_feedback", "plan_mode_response"].includes(tool_call_name)) {
                        this.window.webContents.send('streamData', { group_id, context_id, content: `${content}\n\n`, end: true, del });
                    }
                    let content_format = content.replaceAll("\\`", "'").replaceAll("`", "'");
                    this.window.webContents.send('infoData', { group_id, context_id, content: `Step ${i}, group_id: ${group_id}, context_id: ${context_id}, Output:\n\n\`\`\`json\n${content_format}\n\`\`\`\n\n`, del });
                }
                if (role === "assistant") {
                    if (react) {
                        try {
                            let toolInfo;
                            if (message?.tool_format && message.tool_format !== "prompt") {
                                if (message?.tool_calls) {
                                    let call = message.tool_calls[0];
                                    toolInfo = {
                                        thinking: content,
                                        tool: call?.function?.name,
                                        params: call?.function?.arguments ? json5_1.default.parse(String(call.function.arguments)) : {}
                                    };
                                }
                                else {
                                    toolInfo = { thinking: content, tool: null, params: null };
                                }
                            }
                            else {
                                toolInfo = globals_1.utils.parseJsonContent(content);
                            }
                            const thinking = `${toolInfo?.thinking || `Tool call: ${toolInfo.tool || "error"}`}\n\n---\n\n`;
                            let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("\\`", "'").replaceAll("`", "'");
                            this.window.webContents.send('infoData', { group_id, context_id, content: `Step ${i}, group_id: ${group_id}, context_id: ${context_id}, Output:\n\n\`\`\`json\n${toolInfoStr}\n\`\`\`\n\n`, del });
                            this.window.webContents.send('streamData', { group_id, context_id, content: thinking, end: true, del });
                        }
                        catch (e) {
                            this.window?.webContents.send('streamData', { group_id, context_id, content: null, end: true, del });
                        }
                    }
                    else {
                        this.window.webContents.send('streamData', { group_id: group_id, content: content, end: true, del: del });
                    }
                }
            });
            logger_1.logger.log(`Load success: ${filePath}`);
            let { group_id: group_id, context_id, del } = messages[messages.length - 1];
            this.window.webContents.send('streamData', { group_id, context_id, content: null, end: true, del });
        }
    }
    getInfo(data) {
        const output_format = globals_1.utils.copy(data.output_format);
        data.output_format = data.output_format?.replaceAll("\\`", "'").replaceAll("`", "'");
        let infoTemplate = globals_1.utils.getConfig("info_template");
        let info = this.formatTemplate(infoTemplate, { ...data, ...this.llm_service.chatManager.chat });
        data.output_format = output_format; // 恢复原数据
        logger_1.logger.log(info);
        return info;
    }
}
exports.ReActAgent = ReActAgent;
//# sourceMappingURL=ReActAgent.js.map