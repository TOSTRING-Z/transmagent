import { ReActAgent } from './ReActAgent';
import { LLMService } from './LLMService';
import { Plugins } from './Plugins';
export declare class ChainCall extends ReActAgent {
    plugins: Plugins;
    constructor(plugins: Plugins, llm_service: LLMService, window: any);
    pluginCall(data: Record<string, any>): Promise<any>;
    step(data: Record<string, any>): Promise<void>;
    callChain(data: Record<string, any>): Promise<any>;
}
