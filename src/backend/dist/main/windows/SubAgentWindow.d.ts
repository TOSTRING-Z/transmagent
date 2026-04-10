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
    /**
     * 静默模式下执行子代理任务（不创建窗口）
     */
    private executeInSilentMode;
    setup(): void;
}
