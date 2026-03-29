import JSON5 from 'json5';
import { logger } from '../utils/logger';
import { LLMService } from './LLMService';
import { utils, CONSTANTS } from '../utils/globals';
import { Message, ChatState } from '../types';
import { LLMAssistant } from './LLMAssistant';

export enum State {
    IDLE = 'idle',
    RUNNING = 'running',
    PAUSE = 'pause',
    FINAL = 'final',
    ERROR = 'error',
}

export enum Mode {
    AUTO = 'Automatic mode',
    ACT = 'Execution mode',
    PLAN = 'Planning mode',
    FLASH = 'Flash mode',
}

// 模拟 Electron window 对象的默认结构
const createMockWindow = () => ({
    webContents: {
        send: (channel: string, data: any) => {
            // const timestamp = new Date().toLocaleTimeString();
            // logger.log(`%c[time]${timestamp} Channel: ${channel}, Data:`, "color: blue; font-weight: bold", data);
        }
    }
});

export class ReActAgent {
    public state: State;
    public llm_service: LLMService;
    public window: any;
    public context_id?: string; // 用于记录当前的 memory id
    public assistant: LLMAssistant; // LLM对话辅助功能实例

    constructor(
        llm_service: LLMService,
        window: any = createMockWindow(),
    ) {
        this.state = State.IDLE;
        this.llm_service = llm_service;
        this.window = window;
        // 将窗口句柄注入到 llm_service（若 LLMService 中声明了 window 属性）
        (this.llm_service as any).window = window;
        this.assistant = new LLMAssistant(llm_service);
    }

    // 安全的模板字符串格式化函数（替代被废弃的 String.prototype.format）
    private formatTemplate(template: string | null | undefined, data: Record<string, any>): string {
        if (!template) return "";
        let formatText = template.replaceAll("{{", "{").replaceAll("}}", "}");
        formatText = formatText.replace(/\{(.*?)\}/g, (match, cmd) => {
            try {
                const key = cmd.trim();
                return data[key] !== undefined ? data[key] : match;
            } catch (e: any) {
                console.error(e);
                return match;
            }
        });
        return formatText;
    }

    public changeWindow(window: any = createMockWindow()) {
        this.window = window;
        (this.llm_service as any).window = window;
    }

    public setHistory(chat: ChatState | null = null): boolean | undefined {
        if (!chat) {
            chat = this.llm_service.chatManager.chat;
        }

        if (chat.id) {
            if (chat.tokens == null) chat.tokens = 0;
            if (chat.seconds == null) chat.seconds = 0;

            let history_data = utils.getHistoryData();
            let history_exist = history_data.data.filter((h: any) => h.id === chat!.id);
            let id_exist = history_exist.length > 0;

            if (!id_exist) {
                history_data.data.push(chat);
            } else {
                history_data.data = history_data.data.map((h: any) => h.id === chat.id ? chat : h);
            }

            utils.setHistoryData(history_data);
            const history_path = utils.getHistoryPath(chat.id);
            this.llm_service.chatManager.saveMessages(history_path);
            return id_exist;
        }
    }

    public delHistory(id: string) {
        let history_data = utils.getHistoryData();
        history_data.data = history_data.data.filter((h: any) => h.id !== id);
        utils.setHistoryData(history_data);
    }

    public renameHistory(chat: ChatState) {
        if (this.llm_service.chatManager.chat.id === chat.id) {
            this.llm_service.chatManager.chat.name = chat.name;
        }
        let history_data = utils.getHistoryData();
        history_data.data = history_data.data.map((h: any) => {
            if (h.id === chat.id) h.name = chat.name;
            return h;
        });
        utils.setHistoryData(history_data);
    }

    public async retry(func: (data: Record<string, any>) => Promise<any>, data: any): Promise<any> {
        let retry_time = utils.getConfig("retry_time") || 3;
        let count = 0;

        while (count < retry_time) {
            if (this.llm_service.stopFlag) return null;

            try {
                let output = await func(data);
                if (output) return output;

                count++;
                await utils.delay(2);
            } catch (err: any) {
                console.error("Retry Error:", err);
                count++;
                await utils.delay(2);
            }
        }
        return null;
    }

    public async llmCall(data: Record<string, any>): Promise<Message | null> {
        const configModels = utils.getConfig("models");
        data.api_url = data.api_url || configModels[data.model]?.api_url;
        data.api_key = data.api_key || configModels[data.model]?.api_key;

        data.params = data.params || configModels[data.model]?.versions?.find((v: any) => {
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

        const func = (reqData: any) => this.llm_service.chatBase(reqData);

        let baseResult = await this.retry(func, data);

        if (!baseResult) return null;

        data.outputs.push(utils.copy(data.output));

        data.output_format = data.output_template
            ? this.formatTemplate(data.output_template, data)
            : data.output;

        data.output_formats.push(utils.copy(data.output_format));
        return baseResult;
    }

    public async sendData(data: Record<string, any>): Promise<boolean> {
        let agent_messages = this.llm_service.chatManager.getMessages(true).filter(m => m.group_id === data.id);
        utils.sendData(CONSTANTS.COLLECTION_URL, {
            "chat_id": this.llm_service.chatManager.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        });
        return true;
    }

    public getDataDefault(cdata: any = {}): any {
        let data = utils.copy(cdata);
        let defaults = {
            prompt: null,
            query: null,
            img_url: null,
            file_path: null,
            api_url: null,
            api_key: null,
            model: this.llm_service.chatManager.chat.model,
            version: this.llm_service.chatManager.chat.version,
            is_plugin: this.llm_service.chatManager.chat.model === "plugins",
            output_template: null,
            input_template: null,
            prompt_template: null,
            params: null,
            llm_params: utils.getConfig('tool_call')["llm_params"],
            memory_length: utils.getConfig('tool_call')["memory_length"],
            long_memory_length: utils.getConfig('tool_call')["long_memory_length"],
            max_tokens: utils.getConfig('tool_call')["max_tokens"],
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

    public newChat(): ChatState {
        this.window.webContents.send('clear');
        this.initVar();
        this.llm_service.chatManager.init();
        this.setHistory(this.llm_service.chatManager.chat);
        return this.llm_service.chatManager.chat;
    }

    public initVar() {
        logger.log("可选实现");
    }

    public loadChat(id: string): ChatState {
        this.initVar();
        const history_path = utils.getHistoryPath(id);
        this.loadMessage(history_path);
        return this.llm_service.chatManager.chat;
    }

    public loadMessage(filePath: string) {
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

                    let content_format = (content as string).replaceAll("\\`", "'").replaceAll("`", "'");
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
                                        params: call?.function?.arguments ? JSON5.parse(String(call.function.arguments)) : {}
                                    };
                                } else {
                                    toolInfo = { thinking: content, tool: null, params: null };
                                }
                            } else {
                                toolInfo = utils.parseJsonContent(content as string);
                            }

                            const thinking = `${toolInfo?.thinking || `Tool call: ${toolInfo.tool || "error"}`}\n\n---\n\n`;
                            let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("\\`", "'").replaceAll("`", "'");

                            this.window.webContents.send('infoData', { group_id, context_id, content: `Step ${i}, group_id: ${group_id}, context_id: ${context_id}, Output:\n\n\`\`\`json\n${toolInfoStr}\n\`\`\`\n\n`, del });
                            this.window.webContents.send('streamData', { group_id, context_id, content: thinking, end: true, del });

                        } catch (e: any) {
                            this.window?.webContents.send('streamData', { group_id, context_id, content: null, end: true, del });
                        }
                    } else {
                        this.window.webContents.send('streamData', { group_id: group_id, content: content, end: true, del: del });
                    }
                }
            });
            logger.log(`Load success: ${filePath}`);

            let { group_id: group_id, context_id, del } = messages[messages.length - 1];
            this.window.webContents.send('streamData', { group_id, context_id, content: null, end: true, del });
        }
    }

    public getInfo(data: Record<string, any>): string {
        const output_format = utils.copy(data.output_format);
        data.output_format = data.output_format?.replaceAll("\\`", "'").replaceAll("`", "'");

        let infoTemplate = utils.getConfig("info_template");
        let info = this.formatTemplate(infoTemplate, { ...data, ...this.llm_service.chatManager.chat });

        data.output_format = output_format; // 恢复原数据
        logger.log(info);
        return info;
    }

    /**
     * 对话压缩功能（委托给 LLMAssistant）
     */
    public async compressionGroupMessage(params: { group_id: string }): Promise<string | null> {
        return this.assistant.compressionGroupMessage(params);
    }

    /**
     * 聊天命名功能（委托给 LLMAssistant）
     */
    public async setChatName(data: Record<string, any>): Promise<void> {
        return this.assistant.setChatName(data);
    }
}