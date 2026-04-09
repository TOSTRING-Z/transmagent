import { ReActAgent, Mode } from './ReActAgent';
import { LLMService } from './LLMService';
import { AssistantMessage, Message, ToolInfo } from '../types';
import { MCPClient } from './McpClient';
import Prompts from './Prompts';
import MemoryManager from '../data/MemoryManager';
import { Plugins } from './Plugins';
import { LLMAssistant } from './LLMAssistant';
import { Utils } from './Utils';
import { BrowserWindow } from 'electron/main';
export interface Observation {
    result: string;
    options?: string[];
    ask?: string;
    subagent_tool?: boolean;
}
export interface AgentConfigs {
    agentPrompt?: string | null;
    mcpTool?: boolean;
    mcpPrompt?: boolean;
    todolist?: boolean;
    env?: boolean;
    skill?: boolean;
    subagent?: boolean;
    agentMode: "transagent" | "multagent" | "baseagent";
    agentName?: string;
    toolFormat?: "toolcalls" | "prompt";
}
export interface EnvironmentDetails {
    system_platform: string;
    system_arch: string;
    language: string;
    tmpdir: string;
    time: string;
    mode: Mode;
    mode_constraint: string;
    envs: string | null;
    todolist: string | null;
    skills?: string;
}
export declare class ToolCall extends ReActAgent {
    plugins: Plugins;
    mcp_client: MCPClient;
    agentConfigs: AgentConfigs;
    windowManager: any;
    system_prompt: () => Promise<string> | string;
    mcp_prompt: string;
    tools: Record<string, any>;
    baseTools: Record<string, any>;
    agentTools: Record<string, any>;
    prompts: Prompts;
    memory_manager: MemoryManager;
    task_prompt: (toolsData: any) => string;
    env_prompt: string;
    todolist_prompt: string;
    current_context_id: number;
    memory_list: Message[];
    response_repetitions: (string | null)[];
    repetitions_delay_empty: number;
    toolInfos: ToolInfo[];
    currentToolInfo: ToolInfo | undefined;
    currentObservation: Observation | undefined;
    modeMap: Record<string, Mode>;
    private rememberedChoices;
    llmAssistant: LLMAssistant;
    tool_schemas?: any[];
    constructor(plugins: Plugins, agentTools: Record<string, any> | undefined, llmService: LLMService, window: BrowserWindow | null, utils: Utils, agentConfigs?: AgentConfigs);
    initVar(): void;
    private heartbeatIntervalId;
    setupHeartbeat(): void;
    /**
     * 获取工具配置
     */
    getToolConfig(toolName: string): any;
    loadMessage(filePath: string, id?: string): void;
    getToolsPrompt(): any;
    saveLongTermMemory(user_content: string, final_answer: string): Promise<void>;
    memoryUpdate(data: Record<string, any>): void;
    environmentUpdate(data: Record<string, any>): void;
    changeMode(mode?: string | null, saveHistory?: boolean): void;
    /**
     * 获取已记住的工具选择
     */
    private getRememberedChoice;
    /**
     * 记住工具选择
     */
    private setRememberedChoice;
    step(data: Record<string, any>): Promise<void>;
    getToolInfos(data: Record<string, any>, assistantMessage: AssistantMessage): Promise<ToolInfo[]>;
    act(toolInfo: ToolInfo): Promise<Observation>;
    private handleToolObservation;
    callReAct(data: Record<string, any>, setUUID?: boolean): Promise<any>;
}
