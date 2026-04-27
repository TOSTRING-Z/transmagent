import { LLMBase, State } from './LLMBase';
import { CHAT_CONST } from '../utils/globals';
import { formatString } from '../utils/format';
import { LLMService } from './LLMService';
import { PluginItem, Plugins } from './Plugins';
import { Utils } from './Utils';
import { BrowserWindow } from 'electron/main';
import { copy } from '../utils/public';

export class ChainCall extends LLMBase {
    public plugins: Plugins;

    constructor(plugins: Plugins, llmService: LLMService, window: BrowserWindow | null, utils: Utils) {
        super(llmService, window, utils);
        this.plugins = plugins;
        this.llmService.chatManager.chat.is_plugin = false;
    }

    public async pluginCall(data: Record<string, any>): Promise<any> {
        this.setUUID(data);
        this.window?.webContents.send('userData', { ...this.llmService.chatManager.chat, content: data.query, del: false, uuid: data.uuid });
        data.prompt_format = "";
        data.uuid = this.llmService.chatManager.uuid;

        let func = (this.plugins.getTool(data.version) as PluginItem)?.func;
        if (!func) {
            console.error(`[ChainCall] Plugin function '${data.version}' not found.`);
            return null;
        }

        data.output = await this.retry(func, data);
        if (!data.output) {
            return null;
        }

        data.outputs.push(copy(data.output));

        // 替换原有的 data.output_template.format(data)
        if (data.output_template) {
            data.output_format = formatString(data.output_template, data);
        } else {
            data.output_format = data.output;
        }

        data.output_formats.push(copy(data.output_format));

        this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: data.output_format, end: true, is_plugin: data.is_plugin, uuid: data.uuid });
    }

    public async step(data: Record<string, any>): Promise<void> {
        this.llmService.chatManager.chat.is_plugin = data.model === "plugins";
        let stateResult: any = null;

        if (data.model === "plugins") {
            stateResult = await this.pluginCall(data);
        } else {
            stateResult = await this.llmCall(data);
            // 存入本地记忆与结束反馈
            this.llmService.chatManager.pushUserMessage({ ...this.llmService.chatManager.chat, content: data.query, uuid: data.uuid });
            this.llmService.chatManager.pushAssistantMessage({
                ...this.llmService.chatManager.chat,
                content: data.output,
                reasoning_content: stateResult?.reasoning_content,
                thinking_signature: (stateResult as any)?.thinking_signature,
                uuid: data.uuid
            });
        }

        if (!stateResult) {
            this.llmService.chatManager.chat.state = State.ERROR;
        }

        if (data.end) {
            this.llmService.chatManager.chat.state = State.FINAL;
        }
    }

    public async callChain(data: Record<string, any>): Promise<any> {
        this.setUUID(data);
        this.llmService.chatManager.chat.system_prompt = data.prompt;
        this.llmService.chatManager.chat.state = State.IDLE;
        this.llmService.chatManager.chat.step = 1;
        this.llmService.chatManager.chat.group_id = String((new Date()).getTime());
        this.llmService.chatManager.chat.context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step}`
        this.window?.webContents.send('userData', { ...this.llmService.chatManager.chat, content: data.query, del: false });

        let chain_calls = this.utils.getConfig("chain_call");

        for (const step in chain_calls) {
            if (this.llmService.stopFlag) {
                this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, uuid: data.uuid, end: true });
                break;
            }

            data = { ...data, ...chain_calls[step], step: step };
            const tool_params: Record<string, any> = {};
            const input_data = chain_calls[step]?.input_data || {};

            for (const key in input_data) {
                if (Object.prototype.hasOwnProperty.call(input_data, key)) {
                    const item = input_data[key];
                    // 替换原有的 item.format(data)
                    tool_params[key] = typeof item === 'string' ? formatString(item, data) : item;
                }
            }

            data = { ...data, ...tool_params };

            await this.step(data);

            // 自动命名拦截
            const currentChatName = this.llmService.chatManager.chat.name;
            if (!currentChatName || currentChatName === CHAT_CONST.DEFAULT_NAME) {
                this.setChatName(data).then(() => {
                    if (this.llmService.chatManager.chat.name && this.llmService.chatManager.chat.name !== CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('handleRenameChat', { ...this.llmService.chatManager.chat, uuid: data.uuid });
                    }
                });
            }

            this.setHistory();
            if ((this.llmService.chatManager.chat.state as any) === "final") {
                if (this.llmService.chatManager.chat.is_plugin) {
                    this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: data.output_format, uuid: data.uuid, end: true });
                }
                break;
            }
            if ((this.llmService.chatManager.chat.state as any) === "error") {
                this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: "Error occurred!", uuid: data.uuid, end: true });
                break;
            }

            let info = this.getInfo(data);
            this.window?.webContents.send('infoData', { ...this.llmService.chatManager.chat, content: info, uuid: data.uuid });
        }

        this.sendData(data);
        return data;
    }
}