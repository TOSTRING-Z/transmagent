import { BrowserWindow } from 'electron';
import { ToolCall } from '../../core/ToolCall';
import { AgentTool } from '../../core/SubAgent';
export declare class SubAgentWindow {
    agentToolName?: string;
    agentTool?: AgentTool;
    agentTools: Record<string, AgentTool>;
    windows: BrowserWindow[];
    private windowListeners;
    constructor(agentTools?: Record<string, AgentTool>);
    query(query: string, agentToolName: string, toolCall: ToolCall): Promise<any>;
    create(params?: {
        query: string;
        agentToolName: string;
        toolCall: ToolCall;
    }): Promise<any>;
    destroy(init?: boolean): void;
    setup(): void;
}
