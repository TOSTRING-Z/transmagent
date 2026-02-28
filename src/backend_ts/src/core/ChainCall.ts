import { ReActAgent, State } from './ReActAgent';
import { utils, CHAT_CONST } from '../utils/globals';
import { formatString } from '../utils/format';
import { LLMService } from './LLMService';
import { BaseResult } from '../types';

export class ChainCall extends ReActAgent {
    public is_plugin: boolean;

    constructor(plugins: any, llm_service: LLMService, window: any, alertWindow: any) {
        super(plugins, llm_service, window, alertWindow);
        this.is_plugin = false;
    }

    public async pluginCall(data: any): Promise<any> {
        data.prompt_format = "";
        
        let func = this.plugins.getTool(data.version)?.func;
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
        return data.output_format;
    }

    public async step(data: any): Promise<void> {
        this.is_plugin = data.model === "plugins";
        let stateResult = null;
        let baseResult: BaseResult | null = null;
        
        if (data.model === "plugins") {
            stateResult = await this.pluginCall(data);
        } else {
            baseResult = await this.llmCall(data);
        }
        
        if (!stateResult && !baseResult) {
            this.state = State.ERROR;
        }
        
        if (data.end) {
            this.state = State.FINAL;
        }
    }

    public async callChain(data: any): Promise<any> {
        // 适配新架构的 chat 访问
        this.llm_service.chatManager.chat.system_prompt = data.prompt;
        this.state = State.IDLE;
        
        let chain_calls = utils.getConfig("chain_call");
        
        for (const step in chain_calls) {
            // @ts-ignore: 使用我们在 LLMService 重构时添加的 stopFlag
            if (this.llm_service.stopFlag) {
                this.window?.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true });
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
            // @ts-ignore
            if (this.state === State.FINAL) {
                if (this.is_plugin) {
                    this.window?.webContents.send('stream-data', { id: data.id, content: data.output_format, end: true });
                }
                break;
            }
            // @ts-ignore
            if (this.state === State.ERROR) {
                this.window?.webContents.send('stream-data', { id: data.id, content: "Error occurred!", end: true });
                break;
            }

            let info = this.get_info(data);
            this.window?.webContents.send('info-data', { id: data.id, content: info });
        }
        
        this.sendData(data);
        return data;
    }
}