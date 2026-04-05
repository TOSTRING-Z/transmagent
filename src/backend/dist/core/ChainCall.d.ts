import { ReActAgent } from './ReActAgent';
import { LLMService } from './LLMService';
import { Plugins } from './Plugins';
import { Utils } from '../utils/Utils';
import { BrowserWindow } from 'electron/main';
export declare class ChainCall extends ReActAgent {
    plugins: Plugins;
    constructor(plugins: Plugins, llm_service: LLMService, window: BrowserWindow | null, utils: Utils);
    pluginCall(data: Record<string, any>): Promise<any>;
    step(data: Record<string, any>): Promise<void>;
    callChain(data: Record<string, any>): Promise<any>;
}
