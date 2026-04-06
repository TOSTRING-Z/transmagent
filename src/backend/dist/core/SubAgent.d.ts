import { SubAgentWindow } from "../main/windows/SubAgentWindow";
import { Utils } from "../utils/Utils";
import { ToolCall } from "./ToolCall";
import { LLMService } from "./LLMService";
export interface AgentTool {
    tool_call: ToolCall;
    func: (params: {
        query: string;
    }) => Promise<any>;
    getPrompt: () => any;
    mainSubAgent: boolean;
    extra?: any;
}
export interface SubAgentOptions {
    todolist?: boolean;
    env?: boolean;
    skill?: boolean;
    mcp_server?: boolean;
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
    query(query: string, agentToolName: string): Promise<any>;
    private normalizeTool;
    private normalizeTools;
    addAgentTool(tool_name: string, query_prompt: string, agent_description: string, agent_prompt: string, tools: Record<string, any>, options?: SubAgentOptions, mainSubAgent?: boolean): void;
    getMainSubAgent(): Record<string, AgentTool>;
    private toolInit;
}
