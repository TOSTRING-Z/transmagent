"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReActAgent = exports.Mode = exports.State = void 0;
const logger_1 = require("../utils/logger");
const globals_1 = require("../utils/globals");
const LLMAssistant_1 = require("./LLMAssistant");
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
class ReActAgent {
    state;
    llm_service;
    window;
    context_id; // 用于记录当前的 memory id
    assistant; // LLM对话辅助功能实例
    utils;
    constructor(llm_service, window = null, utils) {
        this.state = State.IDLE;
        this.llm_service = llm_service;
        this.window = window;
        this.assistant = new LLMAssistant_1.LLMAssistant(llm_service, null, utils);
        this.utils = utils;
    }
    setUUID(data) {
        data.uuid = this.llm_service.chatManager.uuid;
        this.window?.webContents.send('setUUID', data.uuid);
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
    changeWindow(window = null) {
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
            let history_data = this.utils.getHistoryData();
            let history_exist = history_data.data.filter((h) => h.id === chat.id);
            let id_exist = history_exist.length > 0;
            if (!id_exist) {
                history_data.data.push(chat);
            }
            else {
                history_data.data = history_data.data.map((h) => h.id === chat.id ? chat : h);
            }
            this.utils.setHistoryData(history_data);
            const history_path = this.utils.getHistoryPath(chat.id);
            this.llm_service.chatManager.saveMessages(history_path);
            return id_exist;
        }
    }
    delHistory(id) {
        let history_data = this.utils.getHistoryData();
        history_data.data = history_data.data.filter((h) => h.id !== id);
        this.utils.setHistoryData(history_data);
    }
    renameHistory(chat) {
        if (this.llm_service.chatManager.chat.id === chat.id) {
            this.llm_service.chatManager.chat.name = chat.name;
        }
        let history_data = this.utils.getHistoryData();
        history_data.data = history_data.data.map((h) => {
            if (h.id === chat.id)
                h.name = chat.name;
            return h;
        });
        this.utils.setHistoryData(history_data);
    }
    async retry(func, data) {
        let retry_time = this.utils.getConfig("retry_time") || 3;
        let count = 0;
        while (count < retry_time) {
            if (this.llm_service.stopFlag)
                return null;
            try {
                let output = await func(data);
                if (output)
                    return output;
                count++;
                await this.utils.delay(2);
            }
            catch (err) {
                console.error("Retry Error:", err);
                count++;
                await this.utils.delay(2);
            }
        }
        return null;
    }
    async llmCall(data) {
        const configModels = this.utils.getConfig("models");
        data.api_key = data.api_key || configModels[data.model]?.api_key;
        data.api_type = data.api_type || configModels[data.model]?.api_type;
        const adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter(data.api_type);
        data.api_url = data.api_url || adapter.getConversationalURL(configModels[data.model]?.api_url);
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
        data.outputs.push(this.utils.copy(data.output));
        data.output_format = data.output_template
            ? this.formatTemplate(data.output_template, data)
            : data.output;
        data.output_formats.push(this.utils.copy(data.output_format));
        return baseResult;
    }
    async sendData(data) {
        let agent_messages = this.llm_service.chatManager.getMessages(true).filter(m => m.group_id === data.id);
        this.utils.sendData(globals_1.CONSTANTS.COLLECTION_URL, {
            "chat_id": this.llm_service.chatManager.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        });
        return true;
    }
    getDataDefault(cdata = {}) {
        let data = this.utils.copy(cdata);
        let defaults = {
            prompt: null,
            query: null,
            img_url: null,
            file_path: null,
            api_url: null,
            api_key: null,
            api_type: null,
            model: this.llm_service.chatManager.chat.model,
            version: this.llm_service.chatManager.chat.version,
            is_plugin: this.llm_service.chatManager.chat.model === "plugins",
            output_template: null,
            input_template: null,
            prompt_template: null,
            params: null,
            llm_params: this.utils.getConfig('tool_call')["llm_params"],
            llm_conversation_mode: true,
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
    newChat() {
        this.window?.webContents.send('clear');
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
        const history_path = this.utils.getHistoryPath(id);
        this.loadMessage(history_path);
        return this.llm_service.chatManager.chat;
    }
    loadMessage(filePath) {
        this.window?.webContents.send('clear');
        let messages = this.llm_service.chatManager.loadMessages(filePath);
        const chat = this.llm_service.chatManager.chat;
        if (messages.length > 0) {
            messages.forEach((message, i) => {
                if (message.role === "user") {
                    this.window?.webContents.send('userData', { ...chat, ...message, end: true });
                }
                if (message.role === "tool") {
                    const tool_call_name = message.tool_call_name || "unknown_tool";
                    switch (tool_call_name) {
                        case "display_file":
                            this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                            break;
                        case "add_subtasks":
                        case "complete_subtasks":
                            this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n\`\`\`json\n${message.content}\n\`\`\``, end: true });
                            break;
                    }
                    if (["deep_researcher", "workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_call_name)) {
                        this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                    }
                    if (["ask_user"].includes(tool_call_name)) {
                        this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                    }
                    let content_format = message.content.replaceAll("`", "\\`");
                    this.window?.webContents.send('infoData', { ...chat, ...message, content: `Step ${i}, group_id: ${message.group_id}, context_id: ${message.context_id}, Output:\n\n\`\`\`json\n${content_format}\n\`\`\`\n\n` });
                }
                if (message.role === "assistant") {
                    if (message.react) {
                        try {
                            const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
                            const toolInfos = adapter.getToolInfos(message);
                            const toolInfo = toolInfos[0] || { content: message.content, reasoning_content: message.reasoning_content || null, tool: null, params: {} };
                            let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("`", "\\`");
                            this.window?.webContents.send('infoData', { ...chat, ...message, content: `Step ${i}, group_id: ${message.group_id}, context_id: ${message.context_id}, Output:\n\n\`\`\`json\n${toolInfoStr}\n\`\`\`` });
                            this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                        }
                        catch (e) {
                            this.window?.webContents.send('streamData', { ...chat, ...message, content: null, end: true });
                        }
                    }
                    else {
                        this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                    }
                }
            });
            this.window?.webContents.send('streamData', { end: true });
            logger_1.logger.log(`Load success: ${filePath}`);
        }
    }
    getInfo(data) {
        const output_format = this.utils.copy(data.output_format);
        data.output_format = data.output_format?.replaceAll("`", "\\`");
        let infoTemplate = this.utils.getConfig("info_template");
        let info = this.formatTemplate(infoTemplate, { ...data, ...this.llm_service.chatManager.chat });
        data.output_format = output_format; // 恢复原数据
        logger_1.logger.log(info);
        return info;
    }
    /**
     * 对话压缩功能（委托给 LLMAssistant）
     */
    async compressionGroupMessage(params) {
        return this.assistant.compressionGroupMessage(params);
    }
    /**
     * 聊天命名功能（委托给 LLMAssistant）
     */
    async setChatName(data) {
        return this.assistant.setChatName(data);
    }
}
exports.ReActAgent = ReActAgent;
//# sourceMappingURL=ReActAgent.js.map