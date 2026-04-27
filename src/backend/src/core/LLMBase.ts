import { logger } from '../utils/logger';
import { LLMService } from './LLMService';
import { CONSTANTS } from '../utils/globals';
import { ChatState, AssistantMessage } from '../types';
import { LLMAssistant } from './LLMAssistant';
import { LLMAdapterFactory } from '../factories/AdapterFactory';
import { BrowserWindow } from 'electron/main';
import { Utils } from './Utils';
import { copy, delay, setHistory } from '../utils/public';

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

export class LLMBase {
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
        this.llmService = llmService;
        this.llmService.chatManager.chat.state = State.IDLE;
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