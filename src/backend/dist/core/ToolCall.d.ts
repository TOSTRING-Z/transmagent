import { ReActAgent, Mode } from './ReActAgent';
import { LLMService } from './LLMService';
import { Message, ToolInfo } from '../types';
import { MCPClient } from './McpClient';
import Prompts from './Prompts';
import MemoryManager from '../data/MemoryManager';
import { Plugins } from './Plugins';
export interface Observation {
    result: string;
    options?: string[];
    ask?: string;
    subagent_tool?: boolean;
}
export interface PromptArgs {
    agent_prompt?: string | null;
    mcp_server?: boolean;
    todolist?: boolean;
    subagent?: boolean;
    agent_mode?: "transagent" | "multagent" | "baseagent";
    tool_format?: string;
}
export interface EnvironmentDetails {
    language: string;
    tmpdir: string;
    time: string;
    mode: Mode;
    envs: string | null;
    todolist: string | null;
    skills?: string;
}
export declare class ToolCall extends ReActAgent {
    plugins: Plugins;
    mcp_client: MCPClient;
    prompt_args: PromptArgs;
    system_prompt: () => Promise<string> | string;
    mcp_prompt: string;
    tools: Record<string, any>;
    baseTools: Record<string, any>;
    agentTools: Record<string, any>;
    prompts: Prompts;
    memory_manager: MemoryManager;
    task_prompt: (toolsData: any) => string;
    env_prompt: string;
    current_context_id: number;
    memory_list: Message[];
    thinking_repetitions: (string | null)[];
    repetitions_delay_empty: number;
    environment_details: EnvironmentDetails;
    toolInfo: ToolInfo | undefined;
    modeMap: Record<string, Mode>;
    constructor(plugins: Plugins, agentTools: Record<string, any> | undefined, llm_service: LLMService, window: any, alertWindow: any, prompt_args?: PromptArgs);
    initVar(): void;
    loadMessage(filePath: string): void;
    getToolsPrompt(): any;
    saveLongTermMemory(user_content: string, final_answer: string): Promise<void>;
    memoryUpdate(data: Record<string, any>): void;
    environmentUpdate(data: Record<string, any>): void;
    changeMode(mode?: string | null): void;
    /**
     * AI 审查者逻辑 (LLM-as-a-Judge) - 缓存优化版
     */
    auditToolCall(toolInfo: ToolInfo, assistantMessage: Message, data: Record<string, any>): Promise<string | null>;
    step(data: Record<string, any>): Promise<void>;
    getToolInfo(data: Record<string, any>, assistantMessage: any): Promise<ToolInfo | undefined>;
    act(toolInfo: ToolInfo): Promise<Observation>;
    callReAct(data: Record<string, any>): Promise<any>;
}
