"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainCall = void 0;
const ReActAgent_1 = require("./ReActAgent");
const globals_1 = require("../utils/globals");
const format_1 = require("../utils/format");
class ChainCall extends ReActAgent_1.ReActAgent {
    plugins;
    constructor(plugins, llm_service, window, utils) {
        super(llm_service, window, utils);
        this.plugins = plugins;
        this.llm_service.chatManager.chat.is_plugin = false;
    }
    async pluginCall(data) {
        this.setUUID(data);
        this.window?.webContents.send('userData', { ...this.llm_service.chatManager.chat, content: data.query, del: false, uuid: data.uuid });
        data.prompt_format = "";
        data.uuid = this.llm_service.chatManager.uuid;
        let func = this.plugins.getTool(data.version)?.func;
        if (!func) {
            console.error(`[ChainCall] Plugin function '${data.version}' not found.`);
            return null;
        }
        data.output = await this.retry(func, data);
        if (!data.output) {
            return null;
        }
        data.outputs.push(this.utils.copy(data.output));
        // 替换原有的 data.output_template.format(data)
        if (data.output_template) {
            data.output_format = (0, format_1.formatString)(data.output_template, data);
        }
        else {
            data.output_format = data.output;
        }
        data.output_formats.push(this.utils.copy(data.output_format));
        this.window?.webContents.send('streamData', { ...this.llm_service.chatManager.chat, content: data.output_format, end: true, is_plugin: data.is_plugin, uuid: data.uuid });
    }
    async step(data) {
        this.llm_service.chatManager.chat.is_plugin = data.model === "plugins";
        let stateResult = null;
        if (data.model === "plugins") {
            stateResult = await this.pluginCall(data);
        }
        else {
            stateResult = await this.llmCall(data);
            // 存入本地记忆与结束反馈
            this.llm_service.chatManager.pushUserMessage({ ...this.llm_service.chatManager.chat, content: data.query, uuid: data.uuid });
            this.llm_service.chatManager.pushAssistantMessage({ ...this.llm_service.chatManager.chat, content: data.output, uuid: data.uuid });
        }
        if (!stateResult) {
            this.state = ReActAgent_1.State.ERROR;
        }
        if (data.end) {
            this.state = ReActAgent_1.State.FINAL;
        }
    }
    async callChain(data) {
        this.setUUID(data);
        this.llm_service.chatManager.chat.system_prompt = data.prompt;
        this.state = ReActAgent_1.State.IDLE;
        this.llm_service.chatManager.chat.step = 1;
        this.llm_service.chatManager.chat.group_id = String((new Date()).getTime());
        this.llm_service.chatManager.chat.context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step}`;
        this.window?.webContents.send('userData', { ...this.llm_service.chatManager.chat, content: data.query, del: false });
        let chain_calls = this.utils.getConfig("chain_call");
        for (const step in chain_calls) {
            if (this.llm_service.stopFlag) {
                this.window?.webContents.send('streamData', { ...this.llm_service.chatManager.chat, uuid: data.uuid, end: true });
                break;
            }
            data = { ...data, ...chain_calls[step], step: step };
            const tool_params = {};
            const input_data = chain_calls[step]?.input_data || {};
            for (const key in input_data) {
                if (Object.prototype.hasOwnProperty.call(input_data, key)) {
                    const item = input_data[key];
                    // 替换原有的 item.format(data)
                    tool_params[key] = typeof item === 'string' ? (0, format_1.formatString)(item, data) : item;
                }
            }
            data = { ...data, ...tool_params };
            await this.step(data);
            // 自动命名拦截
            const currentChatName = this.llm_service.chatManager.chat.name;
            if (!currentChatName || currentChatName === globals_1.CHAT_CONST.DEFAULT_NAME) {
                this.setChatName(data).then(() => {
                    if (this.llm_service.chatManager.chat.name && this.llm_service.chatManager.chat.name !== globals_1.CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('handleAutoRenameChat', { ...this.llm_service.chatManager.chat, uuid: data.uuid });
                    }
                });
            }
            this.setHistory();
            if (this.state === "final") {
                if (this.llm_service.chatManager.chat.is_plugin) {
                    this.window?.webContents.send('streamData', { ...this.llm_service.chatManager.chat, content: data.output_format, uuid: data.uuid, end: true });
                }
                break;
            }
            if (this.state === "error") {
                this.window?.webContents.send('streamData', { ...this.llm_service.chatManager.chat, content: "Error occurred!", uuid: data.uuid, end: true });
                break;
            }
            let info = this.getInfo(data);
            this.window?.webContents.send('infoData', { ...this.llm_service.chatManager.chat, content: info, uuid: data.uuid });
        }
        this.sendData(data);
        return data;
    }
}
exports.ChainCall = ChainCall;
//# sourceMappingURL=ChainCall.js.map