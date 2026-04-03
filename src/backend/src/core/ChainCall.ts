import { ReActAgent, State } from './ReActAgent';
import { utils, CHAT_CONST } from '../utils/globals';
import { formatString } from '../utils/format';
import { LLMService } from './LLMService';
import { PluginItem, Plugins } from './Plugins';

export class ChainCall extends ReActAgent {
    public plugins: Plugins;

    constructor(plugins: Plugins, llm_service: LLMService, window: any) {
        super(llm_service, window);
        this.plugins = plugins;
        this.llm_service.chatManager.chat.is_plugin = false;
    }

    public async pluginCall(data: Record<string, any>): Promise<any> {
        this.window.webContents.send('userData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: data.query, del: false });
        data.prompt_format = "";

        let func = (this.plugins.getTool(data.version) as PluginItem)?.func;
        if (!func) {
            console.error(`[ChainCall] Plugin function '${data.version}' not found.`);
            return null;
        }

        data.output = await this.retry(func, data);
        if (!data.output) {
            return null;
        }

        data.outputs.push(utils.copy(data.output));

        // 替换原有的 data.output_template.format(data)
        if (data.output_template) {
            data.output_format = formatString(data.output_template, data);
        } else {
            data.output_format = data.output;
        }

        data.output_formats.push(utils.copy(data.output_format));

        this.window?.webContents.send('streamData', { ...this.llm_service.chatManager.chat, content: data.output_format, end: true, is_plugin: data.is_plugin });
    }

    public async step(data: Record<string, any>): Promise<void> {
        this.llm_service.chatManager.chat.is_plugin = data.model === "plugins";
        let stateResult: any = null;

        if (data.model === "plugins") {
            stateResult = await this.pluginCall(data);
        } else {
            stateResult = await this.llmCall(data);
            // 存入本地记忆与结束反馈
            this.llm_service.chatManager.pushUserMessage({ ...this.llm_service.chatManager.chat, content: data.query });
            this.llm_service.chatManager.pushAssistantMessage({ ...this.llm_service.chatManager.chat, content: data.output });
        }

        if (!stateResult) {
            this.state = State.ERROR;
        }

        if (data.end) {
            this.state = State.FINAL;
        }
    }

    public async callChain(data: Record<string, any>): Promise<any> {
        // 适配新架构的 chat 访问
        this.llm_service.chatManager.chat.system_prompt = data.prompt;
        this.state = State.IDLE;
        this.llm_service.chatManager.chat.step = 1;
        this.llm_service.chatManager.chat.group_id = String((new Date()).getTime());
        this.llm_service.chatManager.chat.context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step}`
        this.window.webContents.send('userData', { ...this.llm_service.chatManager.chat, content: data.query, del: false });

        let chain_calls = utils.getConfig("chain_call");

        for (const step in chain_calls) {
            if (this.llm_service.stopFlag) {
                this.window?.webContents.send('streamData', { ...this.llm_service.chatManager.chat, content: "", end: true });
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
            const currentChatName = this.llm_service.chatManager.chat.name;
            if (!currentChatName || currentChatName === CHAT_CONST.DEFAULT_NAME) {
                this.setChatName(data).then(() => {
                    if (this.llm_service.chatManager.chat.name && this.llm_service.chatManager.chat.name !== CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('auto-rename-chat', this.llm_service.chatManager.chat);
                    }
                });
            }

            this.setHistory();
            if ((this.state as any) === "final") {
                if (this.llm_service.chatManager.chat.is_plugin) {
                    this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, content: data.output_format, end: true });
                }
                break;
            }
            if ((this.state as any) === "error") {
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, content: "Error occurred!", end: true });
                break;
            }

            let info = this.getInfo(data);
            this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, content: info });
        }

        this.sendData(data);
        return data;
    }
}