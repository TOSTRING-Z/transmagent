"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReActAgent = exports.Mode = exports.State = void 0;
const logger_1 = require("../utils/logger");
const globals_1 = require("../utils/globals");
const LLMAssistant_1 = require("./LLMAssistant");
const AdapterFactory_1 = require("../factories/AdapterFactory");
const public_1 = require("../utils/public");
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
    llmService;
    window;
    context_id; // 用于记录当前的 memory id
    llmAssistant; // LLM对话辅助功能实例
    utils;
    constructor(llmService, window = null, utils) {
        this.state = State.IDLE;
        this.llmService = llmService;
        this.window = window;
        this.llmAssistant = new LLMAssistant_1.LLMAssistant(llmService, null, utils);
        this.utils = utils;
    }
    setUUID(data) {
        if (data) {
            data.uuid = this.llmService.chatManager.uuid;
        }
        this.window?.webContents.send('setUUID', this.llmService.chatManager.uuid);
        return this.llmService.chatManager.uuid;
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
        this.llmService.window = window;
    }
    setHistory(chat = null) {
        if (!chat) {
            chat = this.llmService.chatManager.chat;
        }
        if (chat.id) {
            if (chat.tokens == null)
                chat.tokens = 0;
            if (chat.seconds == null)
                chat.seconds = 0;
            const setStatu = (0, public_1.setHistory)(chat, this.llmService.chatManager.messages);
            return setStatu;
        }
    }
    async retry(func, data) {
        let retry_time = this.utils.getConfig("retry_time") || 3;
        let count = 0;
        while (count < retry_time) {
            if (this.llmService.stopFlag)
                return null;
            try {
                let output = await func(data);
                if (output)
                    return output;
                count++;
                await (0, public_1.delay)(2);
            }
            catch (err) {
                console.error("Retry Error:", err);
                count++;
                await (0, public_1.delay)(2);
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
        const func = (reqData) => this.llmService.chatBase(reqData);
        let baseResult = await this.retry(func, data);
        if (!baseResult)
            return null;
        data.outputs.push((0, public_1.copy)(data.output));
        data.output_format = data.output_template
            ? this.formatTemplate(data.output_template, data)
            : data.output;
        data.output_formats.push((0, public_1.copy)(data.output_format));
        return baseResult;
    }
    async sendData(data) {
        let agent_messages = this.llmService.chatManager.getMessages(true).filter(m => m.group_id === data.id);
        this.utils.sendData(globals_1.CONSTANTS.COLLECTION_URL, {
            "chat_id": this.llmService.chatManager.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        });
        return true;
    }
    getDataDefault(cdata = {}) {
        let data = (0, public_1.copy)(cdata);
        let defaults = {
            prompt: null,
            query: null,
            img_url: null,
            file_path: null,
            api_url: null,
            api_key: null,
            api_type: null,
            model: this.llmService.chatManager.chat.model,
            version: this.llmService.chatManager.chat.version,
            is_plugin: this.llmService.chatManager.chat.model === "plugins",
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
    newChat(id) {
        this.window?.webContents.send('clear');
        this.initVar();
        this.llmService.chatManager.chat.id = id || (0, public_1.getSessionId)();
        this.setHistory(this.llmService.chatManager.chat);
        return this.llmService.chatManager.chat;
    }
    initVar() {
        logger_1.logger.log("可选实现");
    }
    loadChat(id) {
        if (this.llmService.chatManager.chat.id !== id) {
            this.initVar();
        }
        const history_path = this.utils.getHistoryPath(id);
        this.loadMessage(history_path, id);
        return this.llmService.chatManager.chat;
    }
    loadMessage(filePath, id) {
        this.window?.webContents.send('clear');
        let messages = [];
        if (id !== undefined && this.llmService.chatManager.chat.id === id) {
            messages = this.llmService.chatManager.getMessages();
        }
        else {
            messages = this.llmService.chatManager.loadMessages(filePath);
        }
        const chat = this.llmService.chatManager.chat;
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
                            const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(this.llmService.chatManager.chat.tool_format);
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
        const output_format = (0, public_1.copy)(data.output_format);
        data.output_format = data.output_format?.replaceAll("`", "\\`");
        let infoTemplate = this.utils.getConfig("info_template");
        let info = this.formatTemplate(infoTemplate, { ...data, ...this.llmService.chatManager.chat });
        data.output_format = output_format; // 恢复原数据
        logger_1.logger.log(info);
        return info;
    }
    /**
     * 对话压缩功能（委托给 LLMAssistant）
     */
    async compressionGroupMessage(params) {
        return this.llmAssistant.compressionGroupMessage(params);
    }
    /**
     * 聊天命名功能（委托给 LLMAssistant）
     */
    async setChatName(data) {
        return this.llmAssistant.setChatName(data);
    }
}
exports.ReActAgent = ReActAgent;
//# sourceMappingURL=ReActAgent.js.map