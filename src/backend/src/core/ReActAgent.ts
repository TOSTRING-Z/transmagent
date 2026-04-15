import { logger } from '../utils/logger';
import { LLMService } from './LLMService';
import { CONSTANTS } from '../utils/globals';
import { ChatState, AssistantMessage, Message } from '../types';
import { LLMAssistant } from './LLMAssistant';
import { LLMAdapterFactory, ToolCallAdapterFactory } from '../factories/AdapterFactory';
import { BrowserWindow } from 'electron/main';
import { Utils } from './Utils';
import { copy, delay, getSessionId, setHistory } from '../utils/public';

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

export class ReActAgent {
    public state: State;
    public llmService: LLMService;
    public window: BrowserWindow | null;
    public context_id?: string; // 用于记录当前的 memory id
    public llmAssistant: LLMAssistant; // LLM对话辅助功能实例
    public utils: Utils;

    constructor(
        llmService: LLMService,
        window: BrowserWindow | null = null,
        utils: Utils
    ) {
        this.state = State.IDLE;
        this.llmService = llmService;
        this.window = window;
        this.llmAssistant = new LLMAssistant(llmService, null, utils);
        this.utils = utils;
    }

    public setUUID(data?: Record<string, any>): string {
        if (data) {
            data.uuid = this.llmService.chatManager.uuid;           
        }
        this.window?.webContents.send('setUUID', this.llmService.chatManager.uuid);
        return this.llmService.chatManager.uuid;
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

    public changeWindow(window: BrowserWindow | null = null) {
        this.window = window;
        this.llmService.window = window;
    }

    public setHistory(chat: ChatState | null = null): boolean | undefined {
        if (!chat) {
            chat = this.llmService.chatManager.chat;
        }

        if (chat.id) {
            if (chat.tokens == null) chat.tokens = 0;
            if (chat.seconds == null) chat.seconds = 0;
            const setStatu = setHistory(chat, this.llmService.chatManager.messages);
            return setStatu;
        }
    }

    public async retry(func: (data: Record<string, any>) => Promise<any>, data: any): Promise<any> {
        let retry_time = this.utils.getConfig("retry_time") || 3;
        let count = 0;

        while (count < retry_time) {
            if (this.llmService.stopFlag) return null;

            try {
                let output = await func(data);
                if (output) return output;

                count++;
                await delay(2);
            } catch (err: any) {
                console.error("Retry Error:", err);
                count++;
                await delay(2);
            }
        }
        return null;
    }

    public async llmCall(data: Record<string, any>): Promise<AssistantMessage | null> {
        const configModels = this.utils.getConfig("models");
        data.api_key = data.api_key || configModels[data.model]?.api_key;
        data.api_type = data.api_type || configModels[data.model]?.api_type;
        const adapter = LLMAdapterFactory.getAdapter(data.api_type);
        data.api_url = data.api_url || adapter.getConversationalURL(configModels[data.model]?.api_url);

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

        const func = (reqData: any) => this.llmService.chatBase(reqData);

        let baseResult = await this.retry(func, data);

        if (!baseResult) return null;

        data.outputs.push(copy(data.output));

        data.output_format = data.output_template
            ? this.formatTemplate(data.output_template, data)
            : data.output;

        data.output_formats.push(copy(data.output_format));
        return baseResult;
    }

    public async sendData(data: Record<string, any>): Promise<boolean> {
        let agent_messages = this.llmService.chatManager.getMessages(true).filter(m => m.group_id === data.id);
        this.utils.sendData(CONSTANTS.COLLECTION_URL, {
            "chat_id": this.llmService.chatManager.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        });
        return true;
    }

    public getDataDefault(cdata: any = {}): any {
        let data = copy(cdata);
        let defaults = {
            uuid: null,
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

    public newChat(id?: string): ChatState {
        this.window?.webContents.send('clear');
        this.initVar();
        this.llmService.chatManager.chat.id = id || getSessionId();
        this.setHistory(this.llmService.chatManager.chat);
        return this.llmService.chatManager.chat;
    }

    public initVar() {
        logger.log("可选实现");
    }

    public loadChat(id: string): ChatState {
        if (this.llmService.chatManager.chat.id !== id) {
            this.initVar();
        }
        const history_path = this.utils.getHistoryPath(id);
        this.loadMessage(history_path, id);
        return this.llmService.chatManager.chat;
    }

    public loadMessage(filePath: string, id?: string) {
        this.window?.webContents.send('clear');
        let messages: Message[] = [];
        if (id !== undefined && this.llmService.chatManager.chat.id === id) {
            messages = this.llmService.chatManager.getMessages();
        } else {
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

                    let content_format = (message.content as string).replaceAll("`", "\\`");
                    this.window?.webContents.send('infoData', { ...chat, ...message, content: `Step ${i}, group_id: ${message.group_id}, context_id: ${message.context_id}, Output:\n\n\`\`\`json\n${content_format}\n\`\`\`\n\n` });
                }
                if (message.role === "assistant") {
                    try {
                        const tool_format = this.llmService.chatManager.chat.tool_format;
                        const adapter = ToolCallAdapterFactory.getAdapter(tool_format);
                        const toolInfos = adapter.getToolInfos(message);

                        // 对于 tool_format="prompt" 模式，无论 react 是否为 true，都需要通过 adapter 解析
                        // 因为 prompt 模式的 content 可能包含 <thinking> 标签和 JSON tool call
                        if (message.react || tool_format === "prompt") {
                            const toolInfo = toolInfos[0] || { content: message.content, reasoning_content: message.reasoning_content || null, tool: null, params: {} };
                            let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("`", "\\`");
                            this.window?.webContents.send('infoData', { ...chat, ...message, content: `Step ${i}, group_id: ${message.group_id}, context_id: ${message.context_id}, Output:\n\n\`\`\`json\n${toolInfoStr}\n\`\`\`` });
                            this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                        } else {
                            // 非 react 模式且非 prompt 模式，直接输出内容
                            this.window?.webContents.send('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                        }
                    } catch (e: any) {
                        this.window?.webContents.send('streamData', { ...chat, ...message, content: null, end: true });
                    }
                }
            });
            this.window?.webContents.send('streamData', { end: true });
            logger.log(`Load success: ${filePath}`);
        }
    }

    public getInfo(data: Record<string, any>): string {
        const output_format = copy(data.output_format);
        data.output_format = data.output_format?.replaceAll("`", "\\`");

        let infoTemplate = this.utils.getConfig("info_template");
        let info = this.formatTemplate(infoTemplate, { ...data, ...this.llmService.chatManager.chat });

        data.output_format = output_format; // 恢复原数据
        logger.log(info);
        return info;
    }

    /**
     * 对话压缩功能（委托给 LLMAssistant）
     */
    public async compressionGroupMessage(params: { group_id: string }): Promise<string | null> {
        return this.llmAssistant.compressionGroupMessage(params);
    }

    /**
     * 聊天命名功能（委托给 LLMAssistant）
     */
    public async setChatName(data: Record<string, any>): Promise<void> {
        return this.llmAssistant.setChatName(data);
    }
}