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
import { SkillManager } from './SkillManager';
import { AgentEventEmitter, ElectronUIController } from './AgentEventEmitter';
import { TaskScheduler, ISchedulableAgent } from './TaskScheduler';
import {
    ExecutionContext,
    ExecutionPipeline,
    createAuditMiddleware,
    createConfirmationMiddleware,
    createExecutionMiddleware,
    ConfirmationGate,
} from './ExecutionPipeline';

const { all, any, not, always } = ToolDSL;
const { isSubagent, isMode, hasArg } = Primitives;

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
    mode: Mode;
    mode_constraint: string;
    envs: string | null;
    todolist: string | null;
    skills?: string;
}

// ─── 工具策略注册表（模块级常量，避免每次 getToolsPrompt 调用时重新构造）─────

/** 工具策略是"断言函数"，接收 context 返回 boolean。类型别名便于阅读。 */
type ToolPolicyFn = (ctx: {
    args: Record<string, any>;
    env: Record<string, any>;
    modes: typeof Mode;
    isSubagent: boolean;
    currentMode: Mode;
}) => boolean;

const TOOL_POLICY: Record<string, ToolPolicyFn> = {
    'update_env':              all(hasArg('env'), not(isMode('PLAN'))),
    'mcp_server':              all(hasArg('mcpTool'), not(isMode('PLAN'))),
    'add_subtasks':            all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
    'record_subtasks':         all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
    'context_retrieval':       not(isSubagent),
    'search_long_term_memory': not(isSubagent),
    'write_important_memory':  not(isSubagent),
    'ask_user':                all(not(isSubagent), not(any(isMode('FLASH'), isMode('AUTO')))),
    'deep_researcher':         isMode('PLAN'),
};

// ─── ToolCall 主类 ────────────────────────────────────────────────────────────

export class ToolCall extends ReActAgent implements ISchedulableAgent {

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
    public currentObservation: Observation | undefined;
    public modeMap: Record<string, Mode> = {
        "auto": Mode.AUTO, "plan": Mode.PLAN, "flash": Mode.FLASH, "act": Mode.ACT,
    };
    public llmAssistant: LLMAssistant;
    public tool_schemas?: any[];
    public skillManager: SkillManager;

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
            agentName: "TransMAgent",
        },
    ) {
        super(llmService, window, utils);
        this.llmService   = llmService;
        this.plugins      = plugins;
        this.llmAssistant = new LLMAssistant(llmService, plugins, utils);
        this.mcp_client   = new MCPClient(this);
        this.skillManager = new SkillManager(null, utils.getSshConfig());
        this.agentConfigs = agentConfigs;

        this.initVar();

        this.baseTools  = getBaseTools();
        this.agentTools = agentTools;
        this.tools      = {};

        this.prompts        = new Prompts(this);
        this.memory_manager = new MemoryManager(utils);

        this.task_prompt    = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt     = this.prompts.getEnvPrompts();
        this.todolist_prompt = this.prompts.getTodoListPrompt();

        // 初始化事件总线
        this.events = new AgentEventEmitter();

        // 挂载 Electron UI 桥接（仅主进程 Agent）
        if (window && !agentConfigs.subagent) {
            this.uiController = new ElectronUIController(this.events, window);
        }

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
        this.memory_list              = [];
        this.response_repetitions     = [];
        this.repetitions_delay_empty  = 0;

        this.llmService.environment_details = {
            system_platform: this.utils.getConfig("tool_call")?.system_platform || os.platform(),
            system_arch:     this.utils.getConfig("tool_call")?.system_arch     || os.arch(),
            language:        this.utils.getLanguage(),
            tmpdir:          this.utils.getConfig("tool_call")?.tmpdir          || os.tmpdir(),
            time:            formatDate(),
            mode:            Mode.ACT,
            mode_constraint: MODE_CONSTRAINTS[Mode.ACT],
            envs:            null,
            todolist:        null,
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
            (message, chatPayload, uuid) => {
                this.llmService.chatManager.pushToolMessage({
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
                this.llmService.environment_details.mode === Mode.ACT,
            isAvailable: () => !!WindowManager.instance?.confirmationWindow,
            getRememberedChoice: (name) => this.getRememberedChoice(name),
            setRememberedChoice: (name, confirmed) => this.setRememberedChoice(name, confirmed),
            buildRequest: (toolInfo) => {
                const toolName   = toolInfo.tool_call_name as string;
                const toolConfig = this.getToolConfig(toolName);
                let toolDescription = '';
                try {
                    const prompt = this.tools[toolName]?.getPrompt?.();
                    if (prompt?.description) toolDescription = prompt.description;
                } catch { /* ignore */ }
                return {
                    toolId:              toolInfo.tool_call_id || '',
                    toolName,
                    toolDescription,
                    confirmationMessage: toolConfig?.confirmation_message || `即将执行高风险工具: ${toolName}`,
                    executionDetails:    toolInfo.params,
                };
            },
            showConfirmation: (req) =>
                WindowManager.instance!.confirmationWindow!.showConfirmation(req)
                    .then(r => ({ confirmed: r.confirmed, rememberChoice: r.rememberChoice ?? false })),
        };

        const confirmMW = createConfirmationMiddleware(
            gate,
            (message, chatPayload, uuid) => {
                this.llmService.chatManager.pushToolMessage({
                    ...chatPayload, content: message, uuid,
                });
                this.events.emitEvent('streamData', {
                    ...chatPayload,
                    content: `\n\n---\n\n❌ **执行取消**: ${message}`,
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

        this.pipeline = new ExecutionPipeline()
            .use(auditMW)
            .use(confirmMW)
            .use(executeMW);
    }

    /** 更新 Electron 窗口引用（主窗口重建时调用） */
    public setWindow(window: BrowserWindow | null) {
        this.window = window;
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

    public loadMessage(filePath: string, id?: string) {
        super.loadMessage(filePath, id);
        this.changeMode(this.llmService.chatManager.chat.mode, false);
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
        if (!toolCallConfig.env_message)      agentConfigs.env      = false;

        // 2. DSL 校验上下文
        const context = {
            args:        agentConfigs || {},
            env:         this.llmService.environment_details || {},
            modes:       Mode || {},
            isSubagent:  !!this.agentConfigs?.subagent,
            currentMode: this.llmService.environment_details?.mode,
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
                    const toolConfig         = this.getToolConfig(key);
                    const requireConfirmation = !!toolConfig?.require_confirmation;
                    const isSubagentTool     = Object.keys(this.agentTools).includes(key);
                    const isDeepresearch     = key === 'deep_researcher';
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
                const time    = this.llmService.environment_details.time;
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
                mcp_prompt:       this.mcp_prompt,
                cli_prompt:       this.prompts.getCliPrompt(),
                extra_prompt:     this.prompts.getExtraPrompt(data.extra_prompt),
                skill_prompt:     this.skillManager.getSkillDescription(),
                important_memory: important_memory,
            };
            const systemPrompt = formatString(this.task_prompt(data.tools), paramsToFormat);
            return systemPrompt.replaceAll(/\n{2,}/g, "\n\n").trim();
        };
    }

    public environmentUpdate(data: Record<string, any>) {
        this.llmService.environment_details.time     = formatDate();
        this.llmService.environment_details.language = data?.language || this.utils.getLanguage();
        const chatState = this.llmService.chatManager.chat;

        const envs = Object.keys(chatState.envs || {}).map(key => {
            const env = chatState.envs[key];
            return `- ${key}: [${env._meta.agent} / ${env._meta.timestamp}] ${env.value}`;
        });
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj  = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map(
                (sub: any) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`
            );
            return `- ${task_id}: ${taskObj.task}:\n${subtasks.join("\n")}`;
        });

        this.llmService.environment_details.todolist = todolist.join("\n");
        this.llmService.environment_details.envs     = envs.length > 0 ? envs.join("\n") : "";
        this.llmService.environment_details.skills   = this.skillManager.getSkillDescription();

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
        const selectedMode = this.modeMap[mode || ""] || Mode.ACT;
        const shortMode    = this.modeMap[mode || ""] ? mode : "act";
        this.llmService.environment_details.mode            = selectedMode;
        this.llmService.environment_details.mode_constraint = MODE_CONSTRAINTS[selectedMode];
        this.llmService.chatManager.chat.mode               = shortMode as string;
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
        const hasTool  = this.toolInfos.some(t => t.tool_call_name);
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
            const taskNumber     = String(j + 1).padStart(2, '0');
            const displayContent =
                (toolInfo.content && toolInfo.content !== prevContent)
                    ? toolInfo.content
                    : toolInfo.tool_call_name;
            const displayReasoning =
                (toolInfo.reasoning_content && toolInfo.reasoning_content !== prevReasoningContent)
                    ? toolInfo.reasoning_content
                    : undefined;

            if (toolInfo.content)           prevContent          = toolInfo.content;
            if (toolInfo.reasoning_content) prevReasoningContent = toolInfo.reasoning_content;

            this.events.emitEvent('toolStart', {
                ...this.llmService.chatManager.chat,
                taskNumber,
                content:          displayContent,
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
            chat.memory_length      = Math.floor(chat.memory_length      / 2);
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
                ask:           response?.ask,
                options:       response?.options,
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

        this.currentObservation = observation!;
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

    public async callReAct(data: Record<string, any>, setUUID: boolean = true): Promise<any> {
        if (setUUID) this.setUUID(data);

        const chat = this.llmService.chatManager.chat;

        if (this.state === State.PAUSE) {
            // 从挂起状态恢复：注入用户回复
            data.role = "tool";
            const context_id = `${chat.group_id}${chat.step - 1}`;
            this.llmService.chatManager.pushToolMessage({
                ...this.currentToolInfo, ...chat, context_id, content: data.query, uuid: data.uuid,
            });
            this.events.emitEvent('toolData', {
                ...chat, content: `\n\n---\n\n${data.query}`, uuid: data.uuid,
            });
        } else {
            // 全新对话轮次
            data.role       = "user";
            chat.step       = 1;
            chat.group_id   = String(Date.now());
            chat.context_id = `${chat.group_id}${chat.step}`;
            this.llmService.chatManager.fixMessages();
            this.llmService.chatManager.pushUserMessage({
                ...chat, content: data.query, uuid: data.uuid,
            });
            this.events.emitEvent('userData', {
                ...chat, content: data.query, uuid: data.uuid,
            });
        }

        this.events.emitEvent('agentRunning', { ...chat, uuid: data.uuid });
        this.state     = State.IDLE;
        chat.seconds   = 0;
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
                step:  chat.step,
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
}
