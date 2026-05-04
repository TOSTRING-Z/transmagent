import * as os from 'os';
import { LLMBase, State, MODE_LABELS, MODE_KEYS } from './LLMBase';
import { CHAT_CONST } from '../utils/globals';
import { formatString } from '../utils/format';
import { LLMService } from './LLMService';
import { AssistantMessage, ChatState, Message, ToolInfo } from '../types';
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
import { formatDate, getSessionId, parseJsonContent } from '../utils/public';
import { SkillManager } from './SkillManager';
import { AgentEventEmitter, ElectronUIController } from './AgentEventEmitter';
import { TaskScheduler, ISchedulableAgent } from './TaskScheduler';
import {
    ExecutionContext,
    ExecutionPipeline,
    createAuditMiddleware,
    createConfirmationMiddleware,
    createExecutionMiddleware,
    createBackgroundMessageMiddleware,
    ConfirmationGate,
} from './ExecutionPipeline';
import { BackgroundTaskRegistry } from './BackgroundTaskRegistry';

const { all, any, not, always } = ToolDSL;
const { isSubagent, isMode, hasArg, isAgentMode } = Primitives;

// ─── 公开类型 ─────────────────────────────────────────────────────────────────

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
    envs: string | null;
    todolist: string | null;
    skills?: string;
}

// ─── 工具策略注册表（模块级常量，避免每次 getToolsPrompt 调用时重新构造）─────

/** 工具策略是"断言函数"，接收 context 返回 boolean。类型别名便于阅读。 */
type ToolPolicyFn = (ctx: {
    args: Record<string, any>;
    env: Record<string, any>;
    modes: Record<string, string>;
    isSubagent: boolean;
    currentMode: string;
    agentMode: string;
}) => boolean;

const TOOL_POLICY: Record<string, ToolPolicyFn> = {
    'update_env': all(hasArg('env'), not(isMode('PLAN'))),
    'mcp_server': all(hasArg('mcpTool'), not(isMode('PLAN'))),
    'add_subtasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
    'record_subtasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
    'context_retrieval': not(isSubagent),
    'search_long_term_memory': not(isSubagent),
    'write_important_memory': not(isSubagent),
    'subagent_launcher': all(not(isSubagent), isAgentMode('baseagent')),
    'ask_user': all(not(isSubagent), not(any(isMode('FLASH'), isMode('AUTO')))),
    'deep_researcher': isMode('PLAN'),
};

// ─── ToolCall 主类 ────────────────────────────────────────────────────────────

export class ToolCall extends LLMBase implements ISchedulableAgent {

    // ── 公开属性 ─────────────────────────────────────────────────────────────
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
    public task_prompt: (toolsData: any) => string;
    public env_prompt: string;
    public todolist_prompt: string;
    public current_context_id: number = 0;
    public memory_list: Message[] = [];
    public response_repetitions: (string | null)[] = [];
    public repetitions_delay_empty: number = 0;
    public toolInfos: ToolInfo[] = [];
    public currentToolInfo: ToolInfo | undefined;
    public llmAssistant: LLMAssistant;
    public tool_schemas?: any[];
    public skillManager: SkillManager;
    public mainLLMService: LLMService | null;

    // ── 架构新增 ─────────────────────────────────────────────────────────────
    /** 对外暴露的事件总线：UI 层、测试层均可订阅 */
    public readonly events: AgentEventEmitter;
    /** Electron UI 桥接控制器（仅主进程 Agent） */
    private uiController: ElectronUIController | null = null;
    /** 心跳 / 定时任务调度器（仅非子代理） */
    private scheduler: TaskScheduler | null = null;
    /** 工具执行管道（audit → confirmation → execution） */
    private pipeline!: ExecutionPipeline;
    /** 高风险工具已记住的用户选择 */
    private rememberedChoices: Record<string, boolean> = {};
    /** 当前已注册 BackgroundTaskRegistry handler 的会话 ID */
    private registeredBgSessionId: string | null = null;

    // ─────────────────────────────────────────────────────────────────────────
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
            agentName: "main",
        },
        mainLLMService: LLMService | null = null,
    ) {
        super(llmService, window, utils);
        this.llmService = llmService;
        this.plugins = plugins;
        this.llmAssistant = new LLMAssistant(llmService, plugins, utils);
        this.mcp_client = new MCPClient(this);
        this.skillManager = new SkillManager(null, utils.getSshConfig());
        this.agentConfigs = agentConfigs;
        this.mainLLMService = mainLLMService;

        this.initVar();

        this.baseTools = getBaseTools();
        this.agentTools = agentTools;
        this.tools = {};

        this.prompts = new Prompts(this);
        this.memory_manager = new MemoryManager();

        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
        this.todolist_prompt = this.prompts.getTodoListPrompt();

        // 初始化事件总线
        this.events = new AgentEventEmitter();

        // 挂载 Electron UI 桥接
        this.uiController = new ElectronUIController(this.events, window);

        // 启动心跳调度器（仅非子代理）
        if (!agentConfigs.subagent) {
            this.scheduler = new TaskScheduler(this);
            this.scheduler.start();
        }

        // 构建执行管道
        this.buildPipeline();
    }

    // ─── ISchedulableAgent 接口实现 ──────────────────────────────────────────

    public getChatVars(): Record<string, any> {
        return this.llmService.chatManager.chat.vars ?? {};
    }

    public getChatUUID(): string {
        return this.llmService.chatManager.uuid ?? '';
    }

    // ─── 初始化与生命周期 ─────────────────────────────────────────────────────

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
            envs: null,
            todolist: null,
        };
    }

    /**
     * 构建（或重建）执行管道：audit → confirmation → execution
     * 三层中间件各自独立，可单独测试，新增拦截只需 .use(newMW)。
     */
    private buildPipeline(): void {
        const getChatPayload = () => ({ ...this.llmService.chatManager.chat });

        // 1. 审计中间件
        const auditMW = createAuditMiddleware(
            (toolInfo, data) => this.llmAssistant.auditToolCall(toolInfo, data, this),
            (toolInfo, message, chatPayload, uuid) => {
                this.llmService.chatManager.pushToolMessage({
                    ...toolInfo,
                    ...chatPayload,
                    content: `⚠️ **Security Intercept**: ${message}`,
                    uuid,
                });
                this.events.emitEvent('securityIntercept', { ...chatPayload, message, uuid });
            },
            getChatPayload,
        );

        // 2. 确认中间件（Human-in-the-loop）
        const gate: ConfirmationGate = {
            isRequired: (toolName) =>
                !!this.getToolConfig(toolName)?.require_confirmation &&
                this.llmService.chatManager.chat.mode === "act",
            isAvailable: () => !!WindowManager.instance?.confirmationWindow,
            getRememberedChoice: (name) => this.getRememberedChoice(name),
            setRememberedChoice: (name, confirmed) => this.setRememberedChoice(name, confirmed),
            buildRequest: (toolInfo) => {
                const toolName = toolInfo.tool_call_name as string;
                const toolConfig = this.getToolConfig(toolName);
                let toolDescription = '';
                try {
                    const prompt = this.tools[toolName]?.getPrompt?.();
                    if (prompt?.description) toolDescription = prompt.description;
                } catch { /* ignore */ }
                return {
                    toolId: toolInfo.tool_call_id || '',
                    toolName,
                    toolDescription,
                    confirmationMessage: toolConfig?.confirmation_message || `High-risk tool about to be executed: ${toolName}`,
                    executionDetails: toolInfo.params,
                };
            },
            showConfirmation: (req) =>
                WindowManager.instance!.confirmationWindow!.showConfirmation(req)
                    .then(r => ({ confirmed: r.confirmed, rememberChoice: r.rememberChoice ?? false })),
        };

        const confirmMW = createConfirmationMiddleware(
            gate,
            (message, chatPayload, uuid, toolInfo) => {
                this.llmService.chatManager.pushToolMessage({
                    ...toolInfo, ...chatPayload, content: message, uuid,
                });
                this.events.emitEvent('streamData', {
                    ...chatPayload,
                    content: `\n\n---\n\n❌ **Cancel execution**: ${message}`,
                    uuid,
                });
            },
            getChatPayload,
        );

        // 3. 执行中间件（管道末端）
        const executeMW = createExecutionMiddleware(
            (toolInfo) => this.act(toolInfo),
            (obs, toolInfo, data) => this.handleToolObservation(obs, toolInfo, data),
            () => this.state === State.PAUSE,
        );

        // ── 后台消息 Handler：即时投递 + agent 空闲时自动唤醒 ────────────
        // 仅主代理注册会话级 handler；子代理使用 registerAgentListener 替代
        if (!this.agentConfigs.subagent) {
        const sessionId = this.llmService.chatManager.chat.id;

        // 先注销旧 Handler（防止重复注册）
        if (this.registeredBgSessionId) {
            BackgroundTaskRegistry.unregisterHandler(this.registeredBgSessionId);
        }
        this.registeredBgSessionId = sessionId;

        BackgroundTaskRegistry.registerHandler(sessionId, (msg) => {
            // ── 活跃状态守卫：agent 正在处理工具调用，不可直接注入 chat ──
            // 返回 false 告知 deliverToMainSession 将消息入队，
            // 由 createBackgroundMessageMiddleware 在安全时机 drain。
            if (this.state !== State.IDLE && this.state !== State.FINAL) {
                logger.log(
                    `[ToolCall] Background handler: agent is active (${this.state}), ` +
                    `requeuing ${msg.type} message for middleware drain`
                );
                return false;
            }

            // ── 空闲状态：直接注入 + 唤醒 ──
            let appendedText = '';

            // 1. 根据消息类型格式化注入文本
            if (msg.type === 'task_result') {
                logger.log(`[ToolCall] Background handler: delivering task result "${msg.taskId}" to session "${sessionId}"`);
                appendedText = this.prompts.getTaskResultPrompt(msg.taskId || 'unknown_task', msg.content);
            } else if (msg.type === 'agent_message') {
                logger.log(`[ToolCall] Background handler: delivering agent message to session "${sessionId}"`);
                appendedText = `\n${msg.content}`;
            }

            // 2. 追加内容到上一条消息的 content 末尾
            const messages = this.llmService.chatManager.messages;
            const lastMsg = messages[messages.length - 1];
            if (lastMsg) {
                lastMsg.content = (lastMsg.content || '') + appendedText;
            }

            // 3. 前端 streamData 展示
            this.events.emitEvent('streamData', {
                ...this.llmService.chatManager.chat,
                content: appendedText,
                uuid: this.llmService.chatManager.uuid,
            });

            // 4. 自动唤醒 ReAct 循环（skipInitialPush=true，消息已在上方注入）
            const wakeReason = msg.type === 'task_result' ? `task "${msg.taskId}"` : 'incoming agent message';
            logger.log(`[ToolCall] Waking agent from "${this.state}" state for ${wakeReason}`);

            this.llmService.startLoop();
            const wakeData = this.getDataDefault({
                query: '',
            });
            wakeData.uuid = this.llmService.chatManager.uuid;

            this.callReAct(wakeData, false, true).catch((err) => {
                logger.error('[ToolCall] Background wake-up callReAct error:', err);
            });
        });

        } // end if (!this.agentConfigs.subagent)

        // 4. 后台消息接收中间件（安全兜底：在处理活跃工具调用前 drain 遗留消息）
        const bgMsgMW = createBackgroundMessageMiddleware(
            () => this.llmService.chatManager.chat.id,
            (msg) => {
                let appendedText = '';

                // 根据消息类型决定如何格式化注入的文本
                if (msg.type === 'task_result') {
                    // 后台任务结果
                    appendedText = this.prompts.getTaskResultPrompt(msg.taskId || 'unknown_task', msg.content);
                } else if (msg.type === 'agent_message') {
                    // 代理间通信消息
                    appendedText = `\n${msg.content}`;
                }

                // 注入到当前对话流的最后一条消息末尾
                const messages = this.llmService.chatManager.messages;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg) {
                    lastMsg.content = (lastMsg.content || '') + appendedText;
                }

                // 前端 streamData 展示
                this.events.emitEvent('streamData', {
                    ...this.llmService.chatManager.chat,
                    content: appendedText,
                    uuid: this.llmService.chatManager.uuid,
                });
            },
        );

        this.pipeline = new ExecutionPipeline()
            .use(bgMsgMW)
            .use(auditMW)
            .use(confirmMW)
            .use(executeMW);
    }

    /** 更新 Electron 窗口引用（主窗口重建时调用） */
    public setWindow(window: BrowserWindow | null) {
        this.window = window;
        this.llmService.window = window;
        this.uiController?.setWindow(window);
    }

    /** 销毁 Agent，释放定时器与事件监听 */
    public destroy() {
        this.scheduler?.stop();
        this.uiController?.destroy();
    }

    // ─── 工具配置 ─────────────────────────────────────────────────────────────

    public getToolConfig(toolName: string): any {
        if (!this.plugins) return null;
        const tool = this.plugins.getTool(toolName);
        return (tool && typeof tool === 'object') ? tool : null;
    }

    public getToolsPrompt(): any {
        // 1. 工具初始化
        if (this.plugins && !this.agentConfigs.subagent) {
            this.plugins.loadInit();
            this.tools = { ...this.plugins.getTool(), ...this.agentTools, ...this.baseTools };
        } else if (this.agentConfigs.subagent) {
            this.tools = { ...this.agentTools, ...this.baseTools };
        }

        let agentConfigs = { ...this.agentConfigs };
        const toolCallConfig = this.utils.getConfig("tool_call");
        if (!toolCallConfig.todolist_message) agentConfigs.todolist = false;
        if (!toolCallConfig.env_message) agentConfigs.env = false;

        // 2. DSL 校验上下文
        const context = {
            args: agentConfigs || {},
            env: this.llmService.environment_details || {},
            modes: MODE_KEYS,
            isSubagent: !!this.agentConfigs?.subagent,
            currentMode: this.llmService.chatManager.chat.mode || "act",
            agentMode: this.agentConfigs?.agentMode || 'transagent',
        };

        const format = this.llmService.chatManager.chat.tool_format;

        // 3. 过滤 → 提取 Schema → 格式化
        this.tool_schemas = Object.entries(this.tools)
            .filter(([key, tool]) => {
                if (!tool?.getPrompt) return false;
                if (tool.enabled === false && !context.isSubagent) return false;
                const policy = TOOL_POLICY[key] ?? always;
                return policy(context);
            })
            .map(([key, tool]) => {
                const schemaOrStr = tool.getPrompt();
                if (context.currentMode === context.modes.PLAN) {
                    const toolConfig = this.getToolConfig(key);
                    const requireConfirmation = !!toolConfig?.require_confirmation;
                    const isSubagentTool = Object.keys(this.agentTools).includes(key);
                    const isDeepresearch = key === 'deep_researcher';
                    return !requireConfirmation && (!isSubagentTool || isDeepresearch) ? schemaOrStr : null;
                }
                if (typeof schemaOrStr === 'string') {
                    return { type: "raw_string", name: key, content: schemaOrStr };
                } else if (Object.entries(schemaOrStr).length > 0) {
                    return schemaOrStr;
                } else {
                    logger.error(`Error tool.getPrompt(): ${key}`);
                }
            })
            .filter(Boolean);

        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(format);
        return adapter.formatTools(this.tool_schemas);
    }

    // ─── 记忆管理 ─────────────────────────────────────────────────────────────

    public async saveLongTermMemory(user_content: string, final_answer: string) {
        try {
            if (user_content && final_answer) {
                const time = this.llmService.environment_details.time;
                const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
                await this.memory_manager.addLongTermMemory(
                    this.llmService.chatManager.chat.id, content, time
                );
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
                skill_prompt: this.skillManager.getSkillDescription(),
                important_memory: important_memory,
            };
            const systemPrompt = formatString(this.task_prompt(data.tools), paramsToFormat);
            return systemPrompt.replaceAll(/\n{2,}/g, "\n\n").trim();
        };
    }

    public environmentUpdate(data: Record<string, any>) {
        this.llmService.environment_details.time = formatDate();
        this.llmService.environment_details.language = data?.language || this.utils.getLanguage();
        const chatState = this.llmService.chatManager.chat;
        const mainChatState = this.mainLLMService ? this.mainLLMService.chatManager.chat : chatState;

        const envs = Object.keys(mainChatState.envs || {}).map(key => {
            const env = mainChatState.envs[key];
            return `- ${key}: [${env._meta.agent} / ${env._meta.timestamp}] ${env.value}`;
        });
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map(
                (sub: any) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`
            );
            return `- ${task_id}: ${taskObj.task}:\n${subtasks.join("\n")}`;
        });

        this.llmService.environment_details.todolist = todolist.join("\n");
        this.llmService.environment_details.envs = envs.length > 0 ? envs.join("\n") : "";
        this.llmService.environment_details.skills = this.skillManager.getSkillDescription();

        // 从 chat.mode 动态注入 mode 信息，用于 env_prompt 模板的 {mode} 和 {mode_constraint} 占位符
        const currentModeShort = chatState.mode || "act";
        (this.llmService.environment_details as any).mode = MODE_LABELS[currentModeShort] || currentModeShort;
        (this.llmService.environment_details as any).mode_constraint = MODE_CONSTRAINTS[currentModeShort];

        const toolCallConfig = this.utils.getConfig("tool_call");
        if (this.agentConfigs.env && toolCallConfig.env_message) {
            data.env_message = formatString(this.env_prompt, this.llmService.environment_details as any);
        } else {
            data.env_message = null;
        }
        if (this.agentConfigs.todolist && toolCallConfig.todolist_message) {
            data.todolist_message = formatString(this.todolist_prompt, this.llmService.environment_details as any);
        } else {
            data.todolist_message = null;
        }
    }

    public changeMode(mode: string | null = null, saveHistory: boolean = true) {
        const shortMode = mode || "act";
        this.llmService.chatManager.chat.mode = shortMode as string;
        if (!this.agentConfigs.subagent && saveHistory) this.setHistory();
    }

    // ─── 高风险工具记忆选择 ───────────────────────────────────────────────────

    private getRememberedChoice(toolName: string): boolean | null {
        return this.rememberedChoices.hasOwnProperty(toolName)
            ? this.rememberedChoices[toolName]
            : null;
    }

    private setRememberedChoice(toolName: string, confirmed: boolean) {
        this.rememberedChoices[toolName] = confirmed;
    }

    // ─── step()：单轮 ReAct 步骤 ──────────────────────────────────────────────
    /**
     * 职责划分（重构后）：
     * 1. MCP 初始化 / 环境更新 / System Prompt 构建
     * 2. LLM 调用，获取 toolInfos
     * 3. 重复响应检测（loop guard）
     * 4. 遍历 toolInfos → pipeline（audit → confirmation → execution）
     * 5. Token 上限检测
     */
    public async step(data: Record<string, any>) {
        if (this.state === State.IDLE) this.state = State.RUNNING;

        if (!this.mcp_prompt) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcpPrompt;
        }

        data.llm_conversation_mode = false;
        this.environmentUpdate(data);
        this.memoryUpdate(data);
        data.prompt = await this.system_prompt();

        const messageOutput = await this.llmCall(data);
        if (!messageOutput) return;

        this.toolInfos = await this.getToolInfos(data, messageOutput);

        if (!this.toolInfos || this.toolInfos.length === 0) {
            logger.error(`Tool Info Error`);
            this.events.emitEvent('infoData', {
                ...this.llmService.chatManager.chat,
                content: `Tool Info Error\n`,
                uuid: data.uuid,
            });
            return;
        }

        // ── 重复响应检测 ────────────────────────────────────────────────────
        const currentResponse = JSON.stringify(this.toolInfos);
        if (
            this.response_repetitions.length === 0 ||
            this.response_repetitions[this.response_repetitions.length - 1] === currentResponse
        ) {
            this.response_repetitions.push(currentResponse);
            this.repetitions_delay_empty = 0;
        } else {
            this.repetitions_delay_empty += 1;
            const delayThreshold = this.utils.getConfig("tool_call")?.repetitions_delay_empty ?? 1;
            if (this.repetitions_delay_empty >= delayThreshold) {
                this.response_repetitions = [currentResponse];
                this.repetitions_delay_empty = 0;
            }
        }

        const maxRepetitions = this.utils.getConfig("tool_call")?.max_response_repetitions ?? 5;
        if (this.response_repetitions.length > maxRepetitions) {
            const error_message =
                `Detected repetitive response: "${currentResponse}". ` +
                `Repetition count: ${this.response_repetitions.length}`;
            logger.warn(error_message);
            this.llmService.chatManager.pushAssistantMessage({
                ...this.llmService.chatManager.chat, content: error_message, uuid: data.uuid,
            });
            this.events.emitEvent('streamData', {
                ...this.llmService.chatManager.chat, content: error_message, uuid: data.uuid, end: true,
            });
            this.state = State.ERROR;
            return;
        }

        // ── 消息类型判断 ────────────────────────────────────────────────────
        const hasTool = this.toolInfos.some(t => t.tool_call_name);
        const hasError = this.toolInfos.some(t => t.error);

        if (hasTool || hasError) {
            this.llmService.chatManager.pushAssistantMessageWithToolCalls({
                ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid,
            });
        } else {
            // 纯思考，直接结束本轮
            this.llmService.chatManager.pushAssistantMessage({
                ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid,
            });
            this.events.emitEvent('streamData', {
                ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid, end: true,
            });
            this.state = State.FINAL;
            return;
        }

        // ── 遍历 toolInfos，每个工具经管道执行 ─────────────────────────────
        let prevContent: string | undefined;
        let prevReasoningContent: string | undefined;

        for (let j = 0; j < this.toolInfos.length; j++) {
            const toolInfo = this.toolInfos[j];
            if (!toolInfo.tool_call_name) continue;

            this.currentToolInfo = toolInfo;

            // 发送任务开始提示
            const taskNumber = String(j + 1).padStart(2, '0');
            const displayContent =
                (toolInfo.content && toolInfo.content !== prevContent)
                    ? toolInfo.content
                    : toolInfo.tool_call_name;
            const displayReasoning =
                (toolInfo.reasoning_content && toolInfo.reasoning_content !== prevReasoningContent)
                    ? toolInfo.reasoning_content
                    : undefined;

            if (toolInfo.content) prevContent = toolInfo.content;
            if (toolInfo.reasoning_content) prevReasoningContent = toolInfo.reasoning_content;

            this.events.emitEvent('toolStart', {
                ...this.llmService.chatManager.chat,
                taskNumber,
                content: displayContent,
                reasoning_content: displayReasoning,
                uuid: data.uuid,
            });

            // 解析错误直接 continue
            if (toolInfo.error) {
                this.llmService.chatManager.pushToolMessage({
                    ...toolInfo, ...this.llmService.chatManager.chat, uuid: data.uuid,
                });
                this.events.emitEvent('streamData', {
                    ...this.llmService.chatManager.chat, content: toolInfo.error, uuid: data.uuid,
                });
                continue;
            }

            // 经管道执行：audit → confirmation → execution
            const ctx = new ExecutionContext(toolInfo, data);
            try {
                await this.pipeline.execute(ctx);
            } catch (err: any) {
                logger.error(`[Pipeline] Unhandled error for tool "${toolInfo.tool_call_name}":`, err);
            }

            // 管道要求挂起整个循环（ask_user 等）
            if (ctx.suspendLoop || this.state === State.PAUSE) break;
        }

        // ── Token 上限检测 ───────────────────────────────────────────────────
        const chat = this.llmService.chatManager.chat;
        if (chat.tokens >= chat.max_tokens) {
            this.llmAssistant.kvCacheSummary();
            chat.long_memory_length = Math.floor(chat.long_memory_length / 2);
            chat.memory_length = Math.floor(chat.memory_length / 2);
        }
    }

    // ─── getToolInfos ─────────────────────────────────────────────────────────

    public async getToolInfos(
        data: Record<string, any>,
        assistantMessage: AssistantMessage
    ): Promise<ToolInfo[]> {
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(
            this.llmService.chatManager.chat.tool_format
        );
        const toolInfos = adapter.getToolInfos(assistantMessage);

        // 网络 / 内容容错
        if (
            toolInfos.length === 1 &&
            !toolInfos[0].content &&
            !toolInfos[0].reasoning_content &&
            !toolInfos[0].tool_call_name
        ) return [];

        data.output_format = JSON.stringify(toolInfos, null, 2);
        this.events.emitEvent('infoData', {
            ...this.llmService.chatManager.chat,
            content: this.getInfo(data),
            uuid: data.uuid,
        });

        return toolInfos;
    }

    // ─── act()：执行单个工具 ──────────────────────────────────────────────────

    public async act(toolInfo: ToolInfo): Promise<Observation> {
        let observation: Observation;
        let checkInterval: NodeJS.Timeout | null = null;

        try {
            if (
                !this.tool_schemas ||
                !this.tool_schemas.map(t => t.name).includes(toolInfo.tool_call_name)
            ) {
                return { result: "Tool does not exist." };
            }

            const will_tool = this.tools[toolInfo.tool_call_name as string].func;

            // 用户中断监听器
            const stopWatcher = new Promise<never>((_, reject) => {
                checkInterval = setInterval(() => {
                    if (this.llmService.stopFlag) {
                        if (checkInterval) clearInterval(checkInterval);
                        reject(new Error("INTERRUPTED_BY_USER"));
                    }
                }, 300);
            });

            // 工具执行
            const executePromise = will_tool({ ...toolInfo?.params, toolCall: this }).then(
                (res: any) => {
                    if (this.llmService.stopFlag) throw new Error("INTERRUPTED_BY_USER");
                    return res;
                }
            );

            const response = await Promise.race([executePromise, stopWatcher]) as any;

            const result: string = response?.subagent_tool
                ? response.content
                : (typeof response === 'string' ? response : JSON.stringify(response, null, 2));

            observation = {
                result,
                ask: response?.ask,
                options: response?.options,
                subagent_tool: response?.subagent_tool,
            };

        } catch (error: any) {
            if (error.message === "INTERRUPTED_BY_USER") {
                logger.log(`[ToolCall] Tool "${toolInfo.tool_call_name}" interrupted by user.`);
                observation = { result: "Execution stopped by user." };
            } else {
                console.error(error);
                observation = { result: `Tool has been executed with error: ${error.message}` };
            }
        } finally {
            if (checkInterval) clearInterval(checkInterval);
        }
        return observation!;
    }

    // ─── handleToolObservation()：统一处理工具执行结果 ───────────────────────

    private handleToolObservation(
        observation: Observation,
        toolInfo: ToolInfo,
        data: Record<string, any>
    ): void {
        if (!toolInfo) {
            console.error("toolInfo is undefined in handleToolObservation");
            return;
        }

        const chat = this.llmService.chatManager.chat;

        // 特殊工具的 UI 渲染差异
        switch (toolInfo.tool_call_name) {
            case "display_file":
                this.events.emitEvent('streamData', {
                    ...chat, content: `\n\n${observation.result}`, uuid: data.uuid,
                });
                break;
            case "add_subtasks":
            case "record_subtasks":
                this.events.emitEvent('streamData', {
                    ...chat,
                    content: `\n\n\`\`\`json\n${observation.result}\n\`\`\``,
                    uuid: data.uuid,
                });
                break;
        }

        if (observation.subagent_tool) {
            this.events.emitEvent('streamData', {
                ...chat, content: `\n\n${observation.result}`, uuid: data.uuid,
            });
        }

        if (this.state === State.PAUSE) {
            // ask_user：输出问题并挂起等待
            this.events.emitEvent('streamData', {
                ...chat, content: `\n\n${observation.ask}`, uuid: data.uuid, end: true,
            });
            this.events.emitEvent('handleOptions', {
                ...chat, ...toolInfo, options: observation.options, uuid: data.uuid,
            });
        } else if (this.state === State.FINAL) {
            this.llmService.chatManager.pushToolMessage({
                ...chat, ...toolInfo, content: observation.result, uuid: data.uuid,
            });
            this.events.emitEvent('streamData', {
                ...chat, content: `\n\n${observation.result}`, uuid: data.uuid, end: true,
            });
        } else {
            this.llmService.chatManager.pushToolMessage({
                ...chat, ...toolInfo, content: observation.result, uuid: data.uuid,
            });
            this.events.emitEvent('infoData', {
                ...chat,
                content: this.getInfo({ output_format: observation.result }),
                uuid: data.uuid,
            });
        }
    }

    // ─── callReAct()：ReAct 主循环 ───────────────────────────────────────────

    /**
     * @param data             ReAct 循环数据
     * @param setUUID          是否自动设置 UUID（默认 true）
     * @param skipInitialPush  跳过初始消息推送（后台任务唤醒用）。
     *                         前置条件：消息已由外部注入 ChatManager。
     *                         若 state === PAUSE 则忽略此参数（挂起恢复必须推送）。
     */
    public async callReAct(data: Record<string, any>, setUUID: boolean = true, skipInitialPush: boolean = false): Promise<any> {
        if (setUUID) this.setUUID(data);

        const chat = this.llmService.chatManager.chat;

        if (this.state === State.PAUSE) {
            // 从挂起状态恢复：注入用户回复（skipInitialPush 不适用于 PAUSE 恢复）
            data.role = "tool";
            const context_id = `${chat.group_id}${chat.step - 1}`;
            this.llmService.chatManager.pushToolMessage({
                ...this.currentToolInfo, ...chat, context_id, content: data.query, uuid: data.uuid,
            });
            this.events.emitEvent('toolData', {
                ...chat, content: `\n\n---\n\n${data.query}`, uuid: data.uuid,
            });
        } else if (!skipInitialPush) {
            // 全新对话轮次
            data.role = "user";
            chat.step = 1;
            chat.group_id = String(Date.now());
            chat.context_id = `${chat.group_id}${chat.step}`;
            this.llmService.chatManager.fixMessages();
            this.llmService.chatManager.pushUserMessage({
                ...chat, content: data.query, uuid: data.uuid,
            });
            this.events.emitEvent('userData', {
                ...chat, content: data.query, uuid: data.uuid,
            });
        }
        // skipInitialPush && state !== PAUSE：消息已由外部注入，直接进入主循环

        this.events.emitEvent('agentRunning', { ...chat, uuid: data.uuid });
        this.state = State.IDLE;
        chat.seconds = 0;
        const tool_call = this.utils.getConfig("tool_call");

        // ── ReAct 主循环 ──────────────────────────────────────────────────────
        while (this.state === State.IDLE || this.state === State.RUNNING) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (this.llmService.stopFlag) {
                this.state = State.FINAL;
                this.events.emitEvent('streamData', {
                    group_id: chat.group_id, end: true, uuid: data.uuid,
                });
                break;
            }

            if (data?.max_step && chat.step > data.max_step) break;

            data = {
                ...data, ...tool_call,
                step: chat.step,
                tools: this.getToolsPrompt(),
                react: true,
            };

            const t0 = Date.now() / 1000;
            await this.step(data);
            chat.seconds += (Date.now() / 1000 - t0);

            chat.step++;
            chat.context_id = `${chat.group_id}${chat.step}`;

            // 自动命名对话
            if (!chat.name || chat.name === CHAT_CONST.DEFAULT_NAME) {
                await this.setChatName(data).then(() => {
                    if (chat.name && chat.name !== CHAT_CONST.DEFAULT_NAME) {
                        this.events.emitEvent('handleRenameChat', { ...chat, uuid: data.uuid });
                    }
                });
            }

            if (!this.agentConfigs.subagent) this.setHistory();
        }

        // ── 循环结束后的清理 ──────────────────────────────────────────────────
        if (this.state === State.FINAL || (this.state as State) === State.ERROR) {
            if (!this.agentConfigs.subagent) {
                this.setHistory();
                this.saveLongTermMemory(data.query, data.output);
                this.llmAssistant.organizeMemory().catch(err => {
                    logger.warn(`[ToolCall] Memory organization failed: ${err}`);
                });
            }
        }

        if (!this.agentConfigs.subagent) {
            this.events.emitEvent('agentIdle', { ...chat, uuid: data.uuid });
            this.sendData(data);
        }

        return data;
    }

    public loadMessage(filePath: string, id?: string) {
        this.events.emitEvent('clear');
        let messages: Message[] = [];
        if (id !== undefined && this.llmService.chatManager.chat.id === id) {
            messages = this.llmService.chatManager.getMessages();
        } else {
            messages = this.llmService.chatManager.loadMessages(filePath);
        }
        const chat = this.llmService.chatManager.chat;
        let state = State.IDLE;
        if (messages.length > 0) {
            messages.forEach((message, i) => {
                if (message.group_id && message.context_id) {
                    this.llmService.chatManager.chat.group_id = message.group_id;
                    this.llmService.chatManager.chat.context_id = message.context_id;
                }
                state = State.RUNNING;
                if (message.role === "user" && !message.react) {
                    this.events.emitEvent('userData', { ...chat, ...message, content: message.content as string, end: true });
                }

                if (message.role === "user" && message.react) {
                    this.events.emitEvent('infoData', { ...chat, ...message, content: `\n\n\`\`\`json\n${message.content}\n\`\`\``, end: true });
                    // 非json内容
                    if (!parseJsonContent(message.content as string))
                        this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                }

                if (message.role === "tool") {
                    const tool_call_name = message.tool_call_name || "unknown_tool";

                    switch (tool_call_name) {
                        case "display_file":
                            this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                            break;
                        case "add_subtasks":
                        case "complete_subtasks":
                            this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n\`\`\`json\n${message.content}\n\`\`\``, end: true });
                            break;
                    }

                    if (["deep_researcher", "workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_call_name)) {
                        this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                    }
                    if (["ask_user"].includes(tool_call_name)) {
                        this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                    }

                    let content_format = (message.content as string).replaceAll("`", "\\`");
                    this.events.emitEvent('infoData', { ...chat, ...message, content: `Step ${i}, group_id: ${message.group_id}, context_id: ${message.context_id}, Output:\n\n\`\`\`json\n${content_format}\n\`\`\`\n\n` });
                }
                if (message.role === "assistant") {
                    try {
                        if (message.react) {
                            const tool_format = this.llmService.chatManager.chat.tool_format;
                            const adapter = ToolCallAdapterFactory.getAdapter(tool_format);
                            const toolInfos = adapter.getToolInfos(message);
                            toolInfos.forEach((toolInfo, j) => {
                                this.currentToolInfo = toolInfo;
                                let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("`", "\\`");
                                this.events.emitEvent('infoData', {
                                    ...chat,
                                    ...message,
                                    content: `Step ${i}, group_id: ${message.group_id}, context_id: ${message.context_id}, Output:\n\n\`\`\`json\n${toolInfoStr}\n\`\`\``
                                });

                                const taskNumber = String(j).padStart(2, '0'); // 格式化为 01, 02...
                                if (toolInfo.content || toolInfo.tool_call_name)
                                    this.events.emitEvent('streamData', {
                                        ...chat,
                                        ...message,
                                        content: `\n\n- 📋 **Task ${taskNumber}** | ${toolInfo.content || toolInfo.tool_call_name}`,
                                        end: true
                                    });
                                if (["ask_user"].includes(toolInfo.tool_call_name as string)) {
                                    state = State.PAUSE;
                                    this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n${toolInfo.params.ask}`, end: true });
                                    if (toolInfo.params?.options && i === (messages.length - 1)) {
                                        this.state = state;
                                        this.events.emitEvent('handleOptions', {
                                            ...chat, ...toolInfo, options: toolInfo.params.options, end: true,
                                        });
                                    }
                                }
                            })
                        } else {
                            this.events.emitEvent('streamData', { ...chat, ...message, content: `\n\n${message.content}`, end: true });
                            state = State.FINAL;
                        }
                    } catch (e: any) {
                        this.events.emitEvent('streamData', { ...chat, ...message, content: undefined, end: true });
                        state = State.ERROR;
                    }
                }
            });
            if (state as State !== State.PAUSE) {
                this.window?.webContents.send('agentIdle', { group_id: chat.group_id });
            }
            this.changeMode(this.llmService.chatManager.chat.mode, false);
            logger.log(`Load success: ${filePath}`);
        }
        // 重新注册后台消息 Handler（会话可能已切换）
        this.buildPipeline();
    }

    public loadChat(id: string): ChatState {
        if (this.llmService.chatManager.chat.id !== id) {
            this.initVar();
        }
        const history_path = this.utils.getHistoryPath(id);
        this.loadMessage(history_path, id);
        return this.llmService.chatManager.chat;
    }

    public newChat(id?: string): ChatState {
        this.events.emitEvent('clear');
        this.initVar();
        this.llmService.chatManager.chat.id = id || getSessionId();
        this.buildPipeline();  // 为新会话注册后台消息 Handler
        this.setHistory(this.llmService.chatManager.chat);
        return this.llmService.chatManager.chat;
    }
}
