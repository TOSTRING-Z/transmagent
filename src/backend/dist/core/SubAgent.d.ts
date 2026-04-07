import { SubAgentWindow } from "../main/windows/SubAgentWindow";
import { Utils } from "./Utils";
import { ToolCall } from "./ToolCall";
import { LLMService } from "./LLMService";
export interface AgentTool {
    toolCall: ToolCall;
    func: (params: {
        query: string;
        toolCall: ToolCall;
    }) => Promise<any>;
    getPrompt: () => any;
    mainSubAgent: boolean;
    extra?: any;
}
export interface SubAgentOptions {
    todolist?: boolean;
    env?: boolean;
    skill?: boolean;
    mcpTool?: boolean;
    mcpPrompt?: boolean;
}
export declare class SubAgent {
    utils: Utils;
    llmService: LLMService;
    agentToolName?: string;
    agentTool?: AgentTool;
    agentTools: Record<string, AgentTool>;
    subAgentWindow: SubAgentWindow;
    private plugins;
    constructor(utils: Utils, llmService: LLMService);
    query(query: string, agentToolName: string, toolCall: ToolCall): Promise<any>;
    private normalizeTool;
    private normalizeTools;
    addAgentTool(tool_name: string, query_prompt: string, agent_description: string, agent_prompt: string, tools: Record<string, any>, options?: SubAgentOptions, mainSubAgent?: boolean): void;
    getMainSubAgent(): Record<string, AgentTool>;
    getAgentTools(): Record<string, AgentTool>;
    private toolInit;
}
