import { BrowserWindow } from 'electron';
import { AgentTool } from '../../core/SubAgent';
import { LLMService } from '../../core/LLMService';
export declare class SubAgentWindow {
    agentToolName?: string;
    agentTool?: AgentTool;
    agentTools: Record<string, AgentTool>;
    windows: BrowserWindow[];
    private windowListeners;
    private llmService;
    constructor(agentTools: Record<string, AgentTool> | undefined, llmService: LLMService);
    query(query: string, agentToolName: string): Promise<any>;
    create(params?: {
        query: string;
        agentToolName: string;
    }): Promise<any>;
    destroy(init?: boolean): void;
    setup(): void;
}
