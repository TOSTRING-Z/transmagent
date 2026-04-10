import * as os from 'os';
import { ReActAgent, State, Mode } from './ReActAgent';
import { CHAT_CONST } from '../utils/globals';
import { formatString } from '../utils/format';
import { LLMService } from './LLMService';
import { AssistantMessage, Message, ToolInfo } from '../types';
import { MCPClient } from './McpClient';
import Prompts, { MODE_CONSTRAINTS } from './Prompts';
import MemoryManager from '../data/MemoryManager';
import getBaseTools from './base_tools';
import { ToolCallAdapterFactory } from '../factories/AdapterFactory';
import { IToolCallAdapter } from '../adapters/IAdapter';
import { Plugins } from './Plugins';
import { ToolDSL, Primitives } from "../utils/ToolDSL";
import { logger } from '../utils/logger';
import { WindowManager } from '../main/windows/WindowManager';
import { LLMAssistant } from './LLMAssistant';
import { Utils } from './Utils';
import { BrowserWindow } from 'electron/main';
import { formatDate, getDefaultConfig } from '../utils/public';
const { all, any, not, always } = ToolDSL;
const { isSubagent, isMode, hasArg } = Primitives;

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

export class ToolCall extends ReActAgent {
    public plugins: Plugins;
    public mcp_client: MCPClient;
    public agentConfigs: AgentConfigs;
    public windowManager: any;
    public system_prompt!: () => Promise<string> | string;
    public mcp_prompt!: string;
    public tools: Record<string, any>;
    public baseTools: Record<string, any>;
    public agentTools: Record<string, any>;
    public prompts: Prompts;
    public memory_manager: MemoryManager;
    public task_prompt: (toolsData) => string;
    public env_prompt: string;
    public todolist_prompt: string;
    public current_context_id: number = 0;
    public memory_list: Message[] = [];
    public response_repetitions: (string | null)[] = [];
    public repetitions_delay_empty: number = 0;
    public toolInfos: ToolInfo[] = [];
    public currentToolInfo: ToolInfo | undefined; // 用于记录当前执行的工具，方便 callReAct 等外部调用读取状态
    public currentObservation: Observation | undefined;
    public modeMap: Record<string, Mode> = { "auto": Mode.AUTO, "plan": Mode.PLAN, "flash": Mode.FLASH, "act": Mode.ACT };
    private rememberedChoices: Record<string, boolean> = {};
    public llmAssistant: LLMAssistant;
    public tool_schemas?: any[];

    constructor(
        plugins: Plugins,
        agentTools: Record<string, any> = {},
        llmService: LLMService,
        window: BrowserWindow | null,
        utils: Utils,
        agentConfigs: AgentConfigs = {
            agentPrompt: null,
            mcpTool: true,
            mcpPrompt: true,
            todolist: true,
            env: true,
            skill: true,
            subagent: false,
            agentMode: "transagent",
            agentName: "TransMAgent",
        },
    ) {
        super(llmService, window, utils);
        this.llmService = llmService;
        this.plugins = plugins;
        this.llmAssistant = new LLMAssistant(llmService, plugins, utils);
        this.mcp_client = new MCPClient(this);
        this.agentConfigs = agentConfigs;

        this.initVar();

        this.baseTools = getBaseTools();
        this.agentTools = agentTools;
        this.tools = {};

        this.prompts = new Prompts(this);
        this.memory_manager = new MemoryManager(utils);

        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
        this.todolist_prompt = this.prompts.getTodoListPrompt();

        // 启动心跳服务
        this.setupHeartbeat();
    }

    public initVar() {
        this.state = State.IDLE;
        this.memory_list = [];
        this.response_repetitions = [];
        this.repetitions_delay_empty = 0;

        this.llmService.environment_details = {
            system_platform: this.utils.getConfig("tool_call")?.system_platform || os.platform(),
            system_arch: this.utils.getConfig("tool_call")?.system_arch || os.arch(),
            language: this.utils.getLanguage(),
            tmpdir: this.utils.getConfig("tool_call")?.tmpdir || os.tmpdir(),
            time: formatDate(),
            mode: Mode.ACT,
            mode_constraint: MODE_CONSTRAINTS[Mode.ACT],
            envs: null,
            todolist: null,
        };
    }

    private heartbeatIntervalId: NodeJS.Timeout | null = null;

    public setupHeartbeat() {
        // 清除现有的心跳定时器
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
            logger.log("[Heartbeat] Existing heartbeat interval cleared");
        }

        const heartbeat = getDefaultConfig("heartbeat");
        const interval = heartbeat?.interval || 60; // 默认60秒

        logger.log(`[Heartbeat] Heartbeat service initialized. Interval: ${interval}s`);

        this.heartbeatIntervalId = setInterval(async () => {
            let hasRecurringTasks = false;
            try {
                const chatVars = this.llmService.chatManager.chat.vars;
                if (chatVars && chatVars.tasks) {
                    // 优化：只要存在 recurring 任务，不论它是 active 还是 wait，都必须保持心跳
                    // 否则任务一旦完成一次，心跳就死了，永远无法触发下一轮
                    hasRecurringTasks = Object.values(chatVars.tasks).some(
                        (task: any) => task.type === "recurring"
                    );
                }
            } catch (e) {
                logger.error("[Heartbeat] Error checking recurring tasks:", e);
            }

            const shouldEnableHeartbeat = hasRecurringTasks || (heartbeat && heartbeat.enabled);

            // 确保代理当前处于空闲状态，避免打断正在执行的任务
            if ((this.state === State.IDLE || this.state === State.FINAL) && shouldEnableHeartbeat) {
                try {
                    const time = this.llmService.environment_details.time || new Date().toISOString();
                    // 优化：极具针对性的唤醒提示词，直接命令代理去检查时间差
                    const query = `[SYSTEM HEARTBEAT @ ${time}] Evaluate your recurring tasks. If a task's trigger_condition is met, initiate the next cycle. If NO tasks are due, respond EXACTLY with [STANDBY].`;

                    logger.log(`[Heartbeat] Triggering ReAct loop at ${time}`);
                    const data = this.getDataDefault({ query });
                    data.uuid = this.llmService.chatManager.uuid;
                    this.callReAct(data, false);
                } catch (e: any) {
                    console.error("[Heartbeat] Execution failed:", e);
                }
            }
        }, interval * 1000);
    }

    /**
     * 获取工具配置
     */
    public getToolConfig(toolName: string): any {
        if (!this.plugins) return null;
        const tool = this.plugins.getTool(toolName);
        return (tool && typeof tool === 'object') ? tool : null;
    }

    public loadMessage(filePath: string, id?: string) {
        super.loadMessage(filePath, id);
        this.changeMode(this.llmService.chatManager.chat.mode, false);
    }

    public getToolsPrompt(): any {
        // --- 工具策略注册表 ---
        // 在这里声明每个工具在什么条件下允许被使用
        const TOOL_POLICY = {
            'update_env': all(hasArg('env'), not(isMode('PLAN'))),
            'mcp_server': all(hasArg('mcpTool'), not(isMode('PLAN'))),
            'add_subtasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
            'record_subtasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
            'context_retrieval': not(isSubagent),
            'search_long_term_memory': not(isSubagent),
            'write_important_memory': not(isSubagent),
            'ask_user': all(not(isSubagent), not(any(isMode('FLASH'), isMode('AUTO')))),
            // PLAN 模式专用：深度研究工具
            'deep_researcher': isMode('PLAN'),
        };

        // --- 核心类方法中的逻辑 ---
        // 1. 工具与插件初始化 (保持原有逻辑)
        if (this.plugins && !this.agentConfigs.subagent) {
            this.plugins.loadInit();
            this.tools = { ...this.plugins.getTool(), ...this.agentTools, ...this.baseTools };
        } else if (this.agentConfigs.subagent) {
            this.tools = { ...this.agentTools, ...this.baseTools };
        }
        // 2. 组装上下文 (供 DSL 校验使用)
        const context = {
            args: this.agentConfigs || {},
            env: this.llmService.environment_details || {},
            modes: Mode || {},
            isSubagent: !!this.agentConfigs?.subagent,
            currentMode: this.llmService.environment_details?.mode
        };
        const format = this.llmService.chatManager.chat.tool_format;
        // 3. 流水线处理：过滤 -> 提取Schema -> 格式化
        this.tool_schemas = Object.entries(this.tools)
            .filter(([key, tool]) => {
                // 步骤 A: 基础校验 (是否有 getPrompt 方法，是否被显式禁用)
                if (!tool?.getPrompt) return false;
                if (tool.enabled === false && !context.isSubagent) return false;
                // 步骤 B: 策略校验 (查表执行 DSL 规则)
                const policy = TOOL_POLICY[key] || always;
                return policy(context);
            })
            .map(([key, tool]) => {
                const schemaOrStr = tool.getPrompt();
                if (context.currentMode === context.modes.PLAN) {
                    // PLAN 模式过滤：移除风险工具 + 普通子代理工具，保留 deepresearch
                    const toolConfig = this.getToolConfig(key);
                    const requireConfirmation = !!toolConfig?.require_confirmation;
                    const isSubagentTool = Object.keys(this.agentTools).includes(key);
                    const isDeepresearch = key === 'deep_researcher';
                    // deepresearch 允许在 PLAN 模式使用
                    return !requireConfirmation && (!isSubagentTool || isDeepresearch) ? schemaOrStr : null;
                }
                if (typeof schemaOrStr === 'string') {
                    return { type: "raw_string", name: key, content: schemaOrStr };
                }
                else if (Object.entries(schemaOrStr).length > 0) {
                    return schemaOrStr;
                } else {
                    logger.error(`Error tool.getPrompt(): ${key}`);
                }
            })
            .filter(Boolean);
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(format);
        return adapter.formatTools(this.tool_schemas);
    }

    public async saveLongTermMemory(user_content: string, final_answer: string) {
        try {
            if (user_content && final_answer) {
                const time = this.llmService.environment_details.time;
                const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
                await this.memory_manager.addLongTermMemory(this.llmService.chatManager.chat.id, content, time);
            }
        } catch (e: any) {
            console.error("Error saving memory", e);
        }
    }

    public memoryUpdate(data: Record<string, any>) {
        this.system_prompt = async () => {
            const important_memory = await this.memory_manager.getImportantMemory();
            const paramsToFormat = {
                mcp_prompt: this.mcp_prompt,
                cli_prompt: this.prompts.getCliPrompt(),
                extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt),
                skill_prompt: this.prompts.getSkillPrompt(),
                important_memory: important_memory,
            }
            const systemPrompt = formatString(this.task_prompt(data.tools), paramsToFormat);
            return systemPrompt.replaceAll(/\n{2,}/g, "\n\n").trim();
        }
    }

    public environmentUpdate(data: Record<string, any>) {
        this.llmService.environment_details.time = formatDate();
        this.llmService.environment_details.language = data?.language || this.utils.getLanguage();
        const chatState = this.llmService.chatManager.chat;

        const envs = Object.keys(chatState.envs || {}).map(key => {
            const env = chatState.envs[key];
            return `- ${key}: [${env._meta.agent} / ${env._meta.timestamp}] ${env.value}`
        });
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map((sub: any) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`);
            return `- ${task_id}: ${taskObj.task}:\n${subtasks.join("\n")}`;
        });

        this.llmService.environment_details.todolist = todolist.join("\n");
        this.llmService.environment_details.envs = envs.length > 0 ? envs.join("\n") : "";
        this.llmService.environment_details.skills = this.prompts.getSkillPrompt();

        if (this.agentConfigs.env && this.utils.getConfig("tool_call")?.env_message) {
            data.env_message = formatString(this.env_prompt, this.llmService.environment_details as any);
        } else {
            data.env_message = null;
        }
        if (this.agentConfigs.todolist && this.utils.getConfig("tool_call")?.todolist_message) {
            data.todolist_message = formatString(this.todolist_prompt, this.llmService.environment_details as any);
        } else {
            data.todolist_message = null;
        }
    }

    public changeMode(mode: string | null = null, saveHistory: boolean = true) {
        const selectedMode = this.modeMap[mode || ""] || Mode.ACT;
        const shortMode = this.modeMap[mode || ""] ? mode : "act";
        this.llmService.environment_details.mode = selectedMode;
        this.llmService.environment_details.mode_constraint = MODE_CONSTRAINTS[selectedMode];
        this.llmService.chatManager.chat.mode = shortMode as string;
        if (!this.agentConfigs.subagent && saveHistory) {
            this.setHistory();
        }
    }
    /**
     * 获取已记住的工具选择
     */
    private getRememberedChoice(toolName: string): boolean | null {
        if (this.rememberedChoices.hasOwnProperty(toolName)) {
            return this.rememberedChoices[toolName];
        }
        return null;
    }

    /**
     * 记住工具选择
     */
    private setRememberedChoice(toolName: string, confirmed: boolean) {
        this.rememberedChoices[toolName] = confirmed;
    }

    public async step(data: Record<string, any>) {
        if (this.state === State.IDLE) {
            this.state = State.RUNNING;
        }

        if (!this.mcp_prompt) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcpPrompt;
        }

        data.llm_conversation_mode = false;

        this.environmentUpdate(data);
        this.memoryUpdate(data);

        data.prompt = await this.system_prompt();
        const messageOutput = await this.llmCall(data);

        if (messageOutput) {
            this.toolInfos = await this.getToolInfos(data, messageOutput);
        } else {
            return;
        }

        if (!this.toolInfos || this.toolInfos.length === 0) {
            logger.error(`Tool Info Error`);
            this.window?.webContents.send('infoData', {
                ...this.llmService.chatManager.chat,
                content: `Tool Info Error\n`,
                uuid: data.uuid
            });
            return
        }; // 容错处理

        // 1. 记录与重复检测
        const currentResponse = JSON.stringify(this.toolInfos);

        if (this.response_repetitions.length === 0 || this.response_repetitions[this.response_repetitions.length - 1] === currentResponse) {
            this.response_repetitions.push(currentResponse);
            this.repetitions_delay_empty = 0;
        } else {
            this.repetitions_delay_empty += 1;
            if (this.repetitions_delay_empty >= (this.utils.getConfig("tool_call")?.repetitions_delay_empty || 1)) {
                this.response_repetitions = [currentResponse];
                this.repetitions_delay_empty = 0;
            }
        }

        if (this.response_repetitions.length > (this.utils.getConfig("tool_call")?.max_response_repetitions || 5)) {
            const error_message = `Detected repetitive response: "${currentResponse}". Repetition count: ${this.response_repetitions.length}`;
            logger.warn(error_message);
            this.llmService.chatManager.pushAssistantMessage({
                ...this.llmService.chatManager.chat,
                content: error_message,
                uuid: data.uuid
            });
            this.window?.webContents.send('streamData', {
                ...this.llmService.chatManager.chat,
                content: error_message,
                uuid: data.uuid,
                end: true
            });
            this.state = State.ERROR;
            return;
        }

        // 2. 先把包含所有 tool_calls 的助手消息压入历史记录 (只压一次！)
        const hasTool = this.toolInfos.some(t => t.tool_call_name);
        const isThinkingOnly = this.toolInfos.length === 1 && !this.toolInfos[0].tool_call_name;

        if (hasTool || isThinkingOnly) {
            this.llmService.chatManager.pushAssistantMessageWithToolCalls({ ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid });
        }

        // 纯思考结束流程
        if (isThinkingOnly) {
            this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, uuid: data.uuid, end: true });
            this.state = State.FINAL;
            return;
        }

        // 3. 循环并发遍历所有工具 (依次执行，确保上下文有序)
        for (const toolInfo of this.toolInfos) {
            if (!toolInfo.tool_call_name) continue;

            this.currentToolInfo = toolInfo; // 更新当前状态引用，供 callReAct 等外部断点恢复使用

            // [1. 解析错误处理]
            if (toolInfo.error) {
                this.llmService.chatManager.pushToolMessage({
                    ...toolInfo, ...this.llmService.chatManager.chat, uuid: data.uuid
                });
                this.window?.webContents.send('streamData', {
                    ...this.llmService.chatManager.chat,
                    content: toolInfo.error,
                    uuid: data.uuid
                });
                continue; // 当前工具执行失败，继续尝试数组中的下一个工具
            }

            // [2. 触发 AI 审查者 (Critic)]
            let auditError = await this.llmAssistant.auditToolCall(toolInfo, data, this);
            if (auditError) {
                this.llmService.chatManager.pushToolMessage({
                    ...toolInfo, ...this.llmService.chatManager.chat, content: `⚠️ **Security Intercept**: ${auditError}`, uuid: data.uuid
                });

                this.window?.webContents.send('streamData', {
                    ...this.llmService.chatManager.chat,
                    content: `\n\n---\n\n⚠️ **Security Intercept**: ${auditError}`,
                    uuid: data.uuid
                });

                continue; // 终止当前风险工具，继续执行数组中下一个工具
            }

            // [3. 高风险工具确认逻辑]
            const toolConfig = this.getToolConfig(toolInfo.tool_call_name);
            const requireConfirmation = !!toolConfig?.require_confirmation;

            if (requireConfirmation && WindowManager.instance?.confirmationWindow && this.llmService.environment_details.mode === Mode.ACT) {

                let toolDescription = '';
                const toolName = toolInfo.tool_call_name;

                // 检查是否有已记住的选择
                const rememberedChoice = this.getRememberedChoice(toolName);
                if (rememberedChoice !== null) {
                    if (rememberedChoice) {
                        let observation = await this.act(toolInfo);
                        this.handleToolObservation(observation, toolInfo, data);
                    } else {
                        const cancelMessage = `用户取消了高风险工具 ${toolInfo.tool_call_name} 的执行（已记住的选择）`;
                        this.llmService.chatManager.pushToolMessage({
                            ...toolInfo, ...this.llmService.chatManager.chat, content: cancelMessage, uuid: data.uuid
                        });
                        this.window?.webContents.send('streamData', {
                            ...this.llmService.chatManager.chat,
                            content: `\n\n---\n\n❌ **执行取消**: ${cancelMessage}`,
                            uuid: data.uuid
                        });
                    }

                    // 如果工具触发了暂停（如提问等），打断并发遍历
                    if (this.state === State.PAUSE) break;
                    continue; // 跳过确认窗口，处理下一个工具
                }

                // 尝试从工具定义中获取描述
                if (this.tools[toolName] && this.tools[toolName].getPrompt) {
                    try {
                        const promptInfo = this.tools[toolName].getPrompt();
                        if (promptInfo && promptInfo.description) {
                            toolDescription = promptInfo.description;
                        }
                    } catch (error) {
                        console.warn(`Failed to get description for tool ${toolName}:`, error);
                    }
                }

                const finalConfirmationMessage = toolConfig?.confirmation_message || `即将执行高风险工具: ${toolName}`;

                // 创建确认请求
                const confirmationRequest = {
                    toolId: toolInfo.tool_call_id || '',
                    toolName: toolName,
                    toolDescription: toolDescription,
                    confirmationMessage: finalConfirmationMessage,
                    executionDetails: toolInfo.params
                };

                try {
                    // 挂起并等待用户在 Electron 弹窗响应
                    const response = await WindowManager.instance.confirmationWindow.showConfirmation(confirmationRequest);

                    if (response.rememberChoice) {
                        this.setRememberedChoice(toolName, response.confirmed);
                    }

                    if (response.confirmed) {
                        let observation = await this.act(toolInfo);
                        this.handleToolObservation(observation, toolInfo, data);
                    } else {
                        const cancelMessage = `用户取消了高风险工具 ${toolInfo.tool_call_name} 的执行`;
                        this.llmService.chatManager.pushToolMessage({
                            ...toolInfo, ...this.llmService.chatManager.chat, content: cancelMessage, uuid: data.uuid
                        });

                        this.window?.webContents.send('streamData', {
                            ...this.llmService.chatManager.chat,
                            content: `\n\n---\n\n❌ **执行取消**: ${cancelMessage}`,
                            uuid: data.uuid
                        });
                    }
                } catch (error) {
                    console.error("确认窗口错误:", error);
                    // 如果确认窗口本身出错（IPC 崩溃等），默认放行执行
                    let observation = await this.act(toolInfo);
                    this.handleToolObservation(observation, toolInfo, data);
                }

                // 状态机流转：如果弹窗后执行的工具（或回调）让状态变成了暂停，直接跳出并发循环
                if (this.state === State.PAUSE) break;
                continue; // 处理完毕当前高风险工具，进行下一个
            }

            // [4. 标准工具安全执行]
            let observation = await this.act(toolInfo);
            this.handleToolObservation(observation, toolInfo, data);

            // [关键防御点]：如果当前工具（例如 ask_user）需要挂起等待用户回复，必须立刻阻断后续工具的并发执行
            if (this.state === State.PAUSE) {
                break;
            }
        }

        if (this.llmService.chatManager.chat.tokens >= this.llmService.chatManager.chat.max_tokens) {
            this.llmAssistant.kvCacheSummary();
            this.llmService.chatManager.chat.long_memory_length = Math.floor(this.llmService.chatManager.chat.long_memory_length / 2);
            this.llmService.chatManager.chat.memory_length = Math.floor(this.llmService.chatManager.chat.memory_length / 2);
        }
    }

    public async getToolInfos(data: Record<string, any>, assistantMessage: AssistantMessage): Promise<ToolInfo[]> {
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(this.llmService.chatManager.chat.tool_format);
        const toolInfos = adapter.getToolInfos(assistantMessage);

        // 网络或内容容错处理
        if (toolInfos.length === 1 && !toolInfos[0].content && !toolInfos[0].reasoning_content && !toolInfos[0].tool_call_name) return [];

        let toolInfoStr = JSON.stringify(toolInfos, null, 2);
        data.output_format = toolInfoStr;

        this.window?.webContents.send('infoData', { ...this.llmService.chatManager.chat, content: this.getInfo(data), uuid: data.uuid });

        const content = toolInfos[0]?.content || "";
        const reasoning_content = toolInfos[0]?.reasoning_content || "";
        if (content || reasoning_content) {
            this.window?.webContents.send('streamData', {
                ...this.llmService.chatManager.chat,
                content: `\n\n${content}`,
                reasoning_content: reasoning_content,
                uuid: data.uuid
            });
        }

        return toolInfos;
    }

    public async act(toolInfo: ToolInfo): Promise<Observation> {
        let observation: Observation;
        let checkInterval: NodeJS.Timeout | null = null;

        try {
            if (!this.tool_schemas || !this.tool_schemas.map(tool => tool.name).includes(toolInfo.tool_call_name)) {
                return { result: "Tool does not exist." };
            }

            const will_tool = this.tools[toolInfo.tool_call_name as string].func;

            const stopWatcher = new Promise<never>((_, reject) => {
                // 这里正常赋值给 checkInterval
                checkInterval = setInterval(() => {
                    if (this.llmService.stopFlag) {
                        if (checkInterval) clearInterval(checkInterval);
                        reject(new Error("INTERRUPTED_BY_USER"));
                    }
                }, 300);
            });

            // 2. 包装工具的执行
            const executePromise = will_tool({ ...toolInfo?.params, toolCall: this }).then(res => {
                // 防御性检查：即使执行完了，如果此时标记为停止，也按中断处理
                if (this.llmService.stopFlag) throw new Error("INTERRUPTED_BY_USER");
                return res;
            });

            // 3. 竞速：谁先完成/报错，就返回谁的结果
            const response = await Promise.race([executePromise, stopWatcher]) as any;

            let result: string;
            if (response?.subagent_tool) {
                result = response.content;
            } else {
                result = typeof response === 'string' ? response : JSON.stringify(response, null, 2);
            }

            observation = {
                result: result,
                ask: response?.ask,
                options: response?.options,
                subagent_tool: response?.subagent_tool
            };

        } catch (error: any) {
            if (error.message === "INTERRUPTED_BY_USER") {
                console.log(`[ToolCall] Tool execution ${toolInfo.tool_call_name} was forcefully interrupted.`);
                observation = { result: "Execution stopped by user." };
            } else {
                console.error(error);
                observation = { result: `Tool has been executed with error: ${error.message}` };
            }
        } finally {
            // 重要：无论工具是正常执行完还是被强制中断，都必须清理定时器防止内存泄漏
            if (checkInterval) clearInterval(checkInterval);
        }

        this.currentObservation = observation;
        return observation;
    }

    private handleToolObservation(observation: Observation, toolInfo: ToolInfo, data: Record<string, any>): void {
        // 确保toolInfo存在
        if (!toolInfo) {
            console.error("toolInfo is undefined in handleToolObservation");
            return;
        }

        switch (toolInfo?.tool_call_name) {
            case "display_file":
                this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n${observation.result}`, uuid: data.uuid });
                break;
            case "add_subtasks":
            case "record_subtasks":
                this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n\`\`\`json\n${observation.result}\n\`\`\``, uuid: data.uuid });
                break;
        }

        if (observation.subagent_tool) {
            this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n${observation.result}`, uuid: data.uuid });
        }

        if (this.state === (State.PAUSE as State)) {
            const { ask, options } = observation;
            this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n${ask}`, uuid: data.uuid, end: true });
            this.window?.webContents.send('handleOptions', { ...this.llmService.chatManager.chat, ...toolInfo, options: options, uuid: data.uuid });
        } else if (this.state === (State.FINAL as State)) {
            this.llmService.chatManager.pushToolMessage({ ...this.llmService.chatManager.chat, ...toolInfo, content: observation.result, uuid: data.uuid });
            this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n${observation.result}`, uuid: data.uuid, end: true });
        } else {
            this.llmService.chatManager.pushToolMessage({ ...this.llmService.chatManager.chat, ...toolInfo, content: observation.result, uuid: data.uuid });
            this.window?.webContents.send('infoData', { ...this.llmService.chatManager.chat, content: this.getInfo({ output_format: observation.result }), uuid: data.uuid });
        }
    }

    public async callReAct(data: Record<string, any>, setUUID: boolean = true): Promise<any> {
        if (setUUID) this.setUUID(data);
        if (this.state === State.PAUSE) {
            data.role = "tool";
            let context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step - 1}`
            this.llmService.chatManager.pushToolMessage({
                ...this.currentToolInfo,
                ...this.llmService.chatManager.chat,
                context_id: context_id,
                content: data.query,
                uuid: data.uuid
            });
            this.window?.webContents.send('toolData', { ...this.llmService.chatManager.chat, content: `\n\n---\n\n${data.query}`, uuid: data.uuid });
        } else {
            this.llmService.chatManager.chat.step = 1;
            this.llmService.chatManager.chat.group_id = String((new Date()).getTime());
            this.llmService.chatManager.chat.context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step}`
            data.role = "user";
            this.llmService.chatManager.fixMessages();
            this.llmService.chatManager.pushUserMessage({ ...this.llmService.chatManager.chat, content: data.query, uuid: data.uuid });
            this.window?.webContents.send('userData', { ...this.llmService.chatManager.chat, content: data.query, uuid: data.uuid });
        }

        this.window?.webContents.send('agentRunning', { ...this.llmService.chatManager.chat, uuid: data.uuid });

        this.state = State.IDLE;
        let tool_call = this.utils.getConfig("tool_call");

        this.llmService.chatManager.chat.seconds = 0

        while (this.state === State.IDLE || this.state === State.RUNNING) {
            // 延时1s，避免过快进入死循环
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.llmService.stopFlag) {
                this.state = State.FINAL;
                this.window?.webContents.send('streamData', { group_id: this.llmService.chatManager.chat.group_id, end: true, uuid: data.uuid });
                break;
            }
            if (data?.max_step && this.llmService.chatManager.chat.step > data.max_step) break;
            data = { ...data, ...tool_call, step: this.llmService.chatManager.chat.step, tools: this.getToolsPrompt(), react: true };

            // 记录开始时间
            const startSeconds = Date.now() / 1000;
            await this.step(data);
            // 记录结束时间
            const endSeconds = Date.now() / 1000;
            this.llmService.chatManager.chat.seconds += (endSeconds - startSeconds);

            this.llmService.chatManager.chat.step++;
            this.llmService.chatManager.chat.context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step}`

            const currentChatName = this.llmService.chatManager.chat.name;
            if (!currentChatName || currentChatName === CHAT_CONST.DEFAULT_NAME) {
                await this.setChatName(data).then(() => {
                    if (this.llmService.chatManager.chat.name && this.llmService.chatManager.chat.name !== CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('handleRenameChat', { ...this.llmService.chatManager.chat, uuid: data.uuid });
                    }
                });
            }

            if (!this.agentConfigs.subagent) {
                this.setHistory();
            }
        }

        if (this.state === State.FINAL || (this.state as State) === State.ERROR) {
            if (!this.agentConfigs.subagent) {
                this.setHistory();
                // 整理记忆文件
                this.llmAssistant.organizeMemory().catch(err => {
                    logger.warn(`[ToolCall] Memory organization failed: ${err}`);
                });
            }
        }

        if (!this.agentConfigs.subagent) {
            // chat.id存在时会添加蓝色完成标志 （仅允许callReAct循环完成添加）
            this.window?.webContents.send('agentIdle', { ...this.llmService.chatManager.chat, uuid: data.uuid });
            this.sendData(data);
        }
        return data;
    }
}