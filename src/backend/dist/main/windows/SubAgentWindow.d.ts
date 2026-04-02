import { BrowserWindow } from 'electron';
import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { ToolCall } from '../../core/ToolCall';
interface AgentTool {
    tool_call: ToolCall;
    func: (params: {
        query: string;
    }) => Promise<any>;
    getPrompt: () => any;
    mainSubAgent: boolean;
    extra?: any;
}
interface SubAgentOptions {
    todolist?: boolean;
    env?: boolean;
    skill?: boolean;
    mcp_server?: boolean;
}
export declare class SubAgentWindow extends BaseWindow {
    agentToolName?: string;
    agentTool?: AgentTool;
    agentTools: Record<string, AgentTool>;
    windows: BrowserWindow[];
    private windowListeners;
    private plugins;
    constructor(windowManager: WindowManager);
    private normalizeTool;
    private normalizeTools;
    query(query: string, agentToolName: string): Promise<any>;
    create(params?: {
        query: string;
        agentToolName: string;
    }): Promise<any>;
    destroy(init?: boolean): void;
    addAgentTool(tool_name: string, query_prompt: string, agent_description: string, agent_prompt: string, tools: Record<string, any>, options?: SubAgentOptions, mainSubAgent?: boolean): void;
    getMainSubAgent(): Record<string, AgentTool>;
    private toolInit;
    setup(): void;
}
export {};
