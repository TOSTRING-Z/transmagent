import { LLMBase, Mode } from './LLMBase';
import { LLMService } from './LLMService';
import { AssistantMessage, ChatState, Message, ToolInfo } from '../types';
import { MCPClient } from './McpClient';
import Prompts from './Prompts';
import MemoryManager from '../data/MemoryManager';
import { Plugins } from './Plugins';
import { LLMAssistant } from './LLMAssistant';
import { Utils } from './Utils';
import { BrowserWindow } from 'electron/main';
import { SkillManager } from './SkillManager';
import { AgentEventEmitter } from './AgentEventEmitter';
import { ISchedulableAgent } from './TaskScheduler';
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
export declare class ToolCall extends LLMBase implements ISchedulableAgent {
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
    modeMap: Record<string, Mode>;
    llmAssistant: LLMAssistant;
    tool_schemas?: any[];
    skillManager: SkillManager;
    mainLLMService: LLMService | null;
    /** 对外暴露的事件总线：UI 层、测试层均可订阅 */
    readonly events: AgentEventEmitter;
    /** Electron UI 桥接控制器（仅主进程 Agent） */
    private uiController;
    /** 心跳 / 定时任务调度器（仅非子代理） */
    private scheduler;
    /** 工具执行管道（audit → confirmation → execution） */
    private pipeline;
    /** 高风险工具已记住的用户选择 */
    private rememberedChoices;
    constructor(plugins: Plugins, agentTools: Record<string, any> | undefined, llmService: LLMService, window: BrowserWindow | null, utils: Utils, agentConfigs?: AgentConfigs, mainLLMService?: LLMService | null);
    getChatVars(): Record<string, any>;
    getChatUUID(): string;
    initVar(): void;
    /**
     * 构建（或重建）执行管道：audit → confirmation → execution
     * 三层中间件各自独立，可单独测试，新增拦截只需 .use(newMW)。
     */
    private buildPipeline;
    /** 更新 Electron 窗口引用（主窗口重建时调用） */
    setWindow(window: BrowserWindow | null): void;
    /** 销毁 Agent，释放定时器与事件监听 */
    destroy(): void;
    getToolConfig(toolName: string): any;
    getToolsPrompt(): any;
    saveLongTermMemory(user_content: string, final_answer: string): Promise<void>;
    memoryUpdate(data: Record<string, any>): void;
    environmentUpdate(data: Record<string, any>): void;
    changeMode(mode?: string | null, saveHistory?: boolean): void;
    private getRememberedChoice;
    private setRememberedChoice;
    /**
     * 职责划分（重构后）：
     * 1. MCP 初始化 / 环境更新 / System Prompt 构建
     * 2. LLM 调用，获取 toolInfos
     * 3. 重复响应检测（loop guard）
     * 4. 遍历 toolInfos → pipeline（audit → confirmation → execution）
     * 5. Token 上限检测
     */
    step(data: Record<string, any>): Promise<void>;
    getToolInfos(data: Record<string, any>, assistantMessage: AssistantMessage): Promise<ToolInfo[]>;
    act(toolInfo: ToolInfo): Promise<Observation>;
    private handleToolObservation;
    callReAct(data: Record<string, any>, setUUID?: boolean): Promise<any>;
    loadMessage(filePath: string, id?: string): void;
    loadChat(id: string): ChatState;
    newChat(id?: string): ChatState;
}
