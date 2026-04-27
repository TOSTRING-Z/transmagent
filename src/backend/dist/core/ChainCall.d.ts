import { LLMBase } from './LLMBase';
import { LLMService } from './LLMService';
import { Plugins } from './Plugins';
import { Utils } from './Utils';
import { BrowserWindow } from 'electron/main';
export declare class ChainCall extends LLMBase {
    plugins: Plugins;
    constructor(plugins: Plugins, llmService: LLMService, window: BrowserWindow | null, utils: Utils);
    pluginCall(data: Record<string, any>): Promise<any>;
    step(data: Record<string, any>): Promise<void>;
    callChain(data: Record<string, any>): Promise<any>;
}
