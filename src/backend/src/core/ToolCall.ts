import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
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
import { formatDate, getHistoryChat, getSessionId, parseJsonContent } from '../utils/public';
import { SkillManager } from './SkillManager';
import { AgentEventEmitter, ElectronUIController } from './AgentEventEmitter';
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

export interface Observation {
    result: string;
    options?: string[];
    ask?: string;
    questions?: Array<{ id: string; question: string; type: 'choice' | 'text' | 'confirm'; options?: string[]; required?: boolean }>;
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

interface ExternalHookDefinition {
    command?: string;
    cwd?: string;
    shell?: boolean | string;
    env?: Record<string, string>;
    enabled?: boolean;
}

type ExternalHookEventName =
    | 'react_loop_before'
    | 'react_loop_after'
    | 'react_step_before'
    | 'react_step_after'
    | 'tool_call_before'
    | 'tool_call_after'
    | 'background_task_before'
    | 'background_task_after';

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
    'remove_tasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
    'context_retrieval': not(isSubagent),
    'search_long_term_memory': not(isSubagent),
    'write_important_memory': not(isSubagent),
    'subagent_launcher': all(not(isSubagent), isAgentMode('baseagent')),
    'ask_user': all(not(isSubagent), not(any(isMode('FLASH'), isMode('AUTO')))),
    'deep_researcher': isMode('PLAN'),
};

export class ToolCall extends LLMBase {
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

    public readonly events: AgentEventEmitter;
    private uiController: ElectronUIController | null = null;
    private pipeline!: ExecutionPipeline;
    private rememberedChoices: Record<string, boolean> = {};
    private registeredBgSessionId: string | null = null;
    private readonly externalHookEvents = new Set<ExternalHookEventName>([
        'react_loop_before',
        'react_loop_after',
        'react_step_before',
        'react_step_after',
        'tool_call_before',
        'tool_call_after',
        'background_task_before',
        'background_task_after',
    ]);

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
            toolFormat: "toolcalls",
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

        this.events = new AgentEventEmitter();
        this.uiController = new ElectronUIController(this.events, window);

        this.buildPipeline();
    }

    public getChatVars(): Record<string, any> {
        return this.llmService.chatManager.chat.vars ?? {};
    }

    public getChatUUID(): string {
        return this.llmService.chatManager.uuid ?? '';
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
            envs: null,
            todolist: null,
        };
    }

    private buildPipeline(): void {
        const getChatPayload = () => ({ ...this.llmService.chatManager.chat });

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

        const executeMW = createExecutionMiddleware(
            (toolInfo) => this.act(toolInfo),
            (obs, toolInfo, data) => this.handleToolObservation(obs, toolInfo, data),
            () => this.state === State.PAUSE,
        );

        if (!this.agentConfigs.subagent) {
            const sessionId = this.llmService.chatManager.chat.id;

            if (this.registeredBgSessionId) {
                BackgroundTaskRegistry.unregisterHandler(this.registeredBgSessionId);
            }
            this.registeredBgSessionId = sessionId;

            BackgroundTaskRegistry.registerHandler(sessionId, (msg) => {
                this.triggerExternalHook('background_task_before', {
                    message_type: msg.type,
                    task_id: msg.taskId || null,
                    content: msg.content,
                });

                if (this.state !== State.IDLE && this.state !== State.FINAL) {
                    logger.log(
                        `[ToolCall] Background handler: agent is active (${this.state}), ` +
                        `requeuing ${msg.type} message for middleware drain`
                    );
                    return false;
                }

                let appendedText = '';
                if (msg.type === 'task_result') {
                    logger.log(`[ToolCall] Background handler: delivering task result "${msg.taskId}" to session "${sessionId}"`);
                    appendedText = this.prompts.getTaskResultPrompt(msg.taskId || 'unknown_task', msg.content);
                } else if (msg.type === 'agent_message') {
                    logger.log(`[ToolCall] Background handler: delivering agent message to session "${sessionId}"`);
                    appendedText = `\n${msg.content}`;
                }

                const currentUUID = this.setUUID();
                const messages = this.llmService.chatManager.messages;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg) {
                    lastMsg.content = (lastMsg.content || '') + appendedText;
                }

                this.events.emitEvent('streamData', {
                    ...this.llmService.chatManager.chat,
                    content: appendedText,
                    uuid: currentUUID,
                });

                const wakeReason = msg.type === 'task_result' ? `task "${msg.taskId}"` : 'incoming agent message';
                logger.log(`[ToolCall] Waking agent from "${this.state}" state for ${wakeReason}`);

                this.llmService.stopFlag = false;
                const wakeData = this.getDataDefault({
                    query: '[SYSTEM: A background task or agent message has been delivered above. Please review the injected information and respond to the user with a summary or acknowledgment.]',
                });
                wakeData.uuid = currentUUID;

                this.callReAct(wakeData, false, true)
                    .catch((err) => {
                        logger.error('[ToolCall] Background wake-up callReAct error:', err);
                    })
                    .finally(() => {
                        this.triggerExternalHook('background_task_after', {
                            message_type: msg.type,
                            task_id: msg.taskId || null,
                            wake_reason: wakeReason,
                        });
                    });
            });
        }

        const bgMsgMW = createBackgroundMessageMiddleware(
            () => this.llmService.chatManager.chat.id,
            (msg) => {
                let appendedText = '';
                if (msg.type === 'task_result') {
                    appendedText = this.prompts.getTaskResultPrompt(msg.taskId || 'unknown_task', msg.content);
                } else if (msg.type === 'agent_message') {
                    appendedText = `\n${msg.content}`;
                }

                const messages = this.llmService.chatManager.messages;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg) {
                    lastMsg.content = (lastMsg.content || '') + appendedText;
                }

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

    public setWindow(window: BrowserWindow | null) {
        this.window = window;
        this.llmService.window = window;
        this.uiController?.setWindow(window);
    }

    public destroy() {
        this.uiController?.destroy();
    }

    private getHookConfig(): Record<string, ExternalHookDefinition> {
        return this.utils.getConfig("tool_call")?.external_hooks || {};
    }

    private getHookDefinition(eventName: ExternalHookEventName): ExternalHookDefinition | null {
        if (!this.externalHookEvents.has(eventName)) return null;
        const definition = this.getHookConfig()?.[eventName];
        if (!definition?.command || definition.enabled === false) return null;
        return definition;
    }

    private async triggerExternalHook(
        eventName: ExternalHookEventName,
        payload: Record<string, any> = {},
        options: { waitForCompletion?: boolean } = {},
    ): Promise<any> {
        const definition = this.getHookDefinition(eventName);
        if (!definition) return null;

        const chat = this.llmService.chatManager.chat;
        const hookPayload = {
            event: eventName,
            timestamp: new Date().toISOString(),
            agent_name: this.agentConfigs.agentName || 'main',
            session_id: chat.id,
            group_id: chat.group_id,
            context_id: chat.context_id,
            step: chat.step,
            state: this.state,
            mode: chat.mode,
            payload,
        };

        try {
            const command = definition.command;
            if (!command) return;

            const child: ChildProcessByStdio<null, Readable, Readable> = spawn(command, {
                cwd: definition.cwd,
                env: {
                    ...process.env,
                    ...(definition.env || {}),
                    TRANSMAGENT_HOOK_EVENT: eventName,
                    TRANSMAGENT_HOOK_PAYLOAD: JSON.stringify(hookPayload),
                },
                shell: definition.shell ?? true,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            });

            let stdout = '';
            child.stdout?.on('data', (chunk) => {
                const text = chunk.toString();
                stdout += text;
                const trimmed = text.trim();
                if (trimmed) logger.log(`[Hook:${eventName}] ${trimmed}`);
            });

            child.stderr?.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) logger.warn(`[Hook:${eventName}:stderr] ${text}`);
            });

            child.on('error', (error) => {
                logger.error(`[Hook:${eventName}] spawn failed:`, error);
            });

            if (!options.waitForCompletion) {
                child.on('close', (code, signal) => {
                    if (code && code !== 0) {
                        logger.warn(`[Hook:${eventName}] exited with code=${code}, signal=${signal || 'none'}`);
                    }
                });
                return null;
            }

            return await new Promise((resolve, reject) => {
                child.on('close', (code, signal) => {
                    if (code && code !== 0) {
                        logger.warn(`[Hook:${eventName}] exited with code=${code}, signal=${signal || 'none'}`);
                    }
                    const trimmed = stdout.trim();
                    if (!trimmed) {
                        resolve(null);
                        return;
                    }
                    try {
                        resolve(JSON.parse(trimmed));
                    } catch {
                        logger.warn(`[Hook:${eventName}] returned non-JSON payload, ignored.`);
                        resolve(null);
                    }
                });
                child.on('error', reject);
            });
        } catch (error) {
            logger.error(`[Hook:${eventName}] trigger failed:`, error);
            return null;
        }
    }

    public getToolConfig(toolName: string): any {
        if (!this.plugins) return null;
        const tool = this.plugins.getTool(toolName);
        return (tool && typeof tool === 'object') ? tool : null;
    }

    public getToolsPrompt(): any {
        if (this.plugins && !this.agentConfigs.subagent) {
            this.plugins.loadInit();
            this.tools = { ...this.plugins.getTool(), ...this.agentTools, ...this.baseTools };
        } else if (this.agentConfigs.subagent) {
            this.tools = { ...this.agentTools, ...this.baseTools };
        }

        const toolCallConfig = this.utils.getConfig("tool_call");
        let agentConfigs = { ...toolCallConfig["agent_configs"], ...this.agentConfigs };

        const context = {
            args: agentConfigs || {},
            env: this.llmService.environment_details || {},
            modes: MODE_KEYS,
            isSubagent: !!this.agentConfigs?.subagent,
            currentMode: this.llmService.chatManager.chat.mode || "act",
            agentMode: this.agentConfigs?.agentMode || 'transagent',
        };

        const format = this.llmService.chatManager.chat.tool_format;

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
            if (env._meta && env.value) {
                return `- ${key}: [${env._meta.agent} / ${env._meta.timestamp}] ${env.value}`;
            }
            // 旧版兼容
            if (typeof env === 'string') {
                return `- ${key}: ${env}`;
            }
        });
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map(
                (sub: any) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`
            );
            return `- ${task_id}: ${taskObj.task_title}:\n${subtasks.join("\n")}`;
        });

        this.llmService.environment_details.todolist = todolist.join("\n");
        this.llmService.environment_details.envs = envs.length > 0 ? envs.join("\n") : "";
        this.llmService.environment_details.skills = this.skillManager.getSkillDescription();

        const currentModeShort = chatState.mode || "act";
        (this.llmService.environment_details as any).mode = MODE_LABELS[currentModeShort] || currentModeShort;
        (this.llmService.environment_details as any).mode_constraint = MODE_CONSTRAINTS[currentModeShort];

        if (this.agentConfigs.env) {
            data.env_message = formatString(this.env_prompt, this.llmService.environment_details as any);
        } else {
            data.env_message = null;
        }
        if (this.agentConfigs.todolist) {
            data.todolist_message = formatString(this.todolist_prompt, this.llmService.environment_details as any);
        } else {
            data.todolist_message = null;
        }
    }

    /**
     * Switch the EXECUTION mode (auto / act / plan / flash), not the Agent mode.
     * For Agent mode switching (transagent / multagent / baseagent), the caller
     * MUST route through SessionManager.setActiveagentMode() instead, which is
     * the only path that rebuilds the Session, writes chat.agentMode and
     * persists the change to history/chat-*.json.
     */
    public changeMode(mode: string | null = null, saveHistory: boolean = true) {
        const shortMode = mode || "act";
        this.llmService.chatManager.chat.mode = shortMode as string;
        if (!this.agentConfigs.subagent && saveHistory) this.setHistory();
    }

    private getRememberedChoice(toolName: string): boolean | null {
        return this.rememberedChoices.hasOwnProperty(toolName)
            ? this.rememberedChoices[toolName]
            : null;
    }

    private setRememberedChoice(toolName: string, confirmed: boolean) {
        this.rememberedChoices[toolName] = confirmed;
    }

    /**
     * 单轮 ReAct 步骤
     * 🌟 修改返回值类型为 Promise<boolean>，显式反馈是否触发了挂起断流
     */
    public async step(data: Record<string, any>): Promise<boolean> {
        if (this.state === State.IDLE) this.state = State.RUNNING;

        this.triggerExternalHook('react_step_before', {
            query: data.query,
            uuid: data.uuid,
        });

        if (!this.mcp_prompt) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcpPrompt;
        }

        data.llm_conversation_mode = false;
        this.environmentUpdate(data);
        this.memoryUpdate(data);
        data.prompt = await this.system_prompt();

        const messageOutput = await this.llmCall(data);
        if (!messageOutput) return false;

        this.toolInfos = await this.getToolInfos(data, messageOutput);

        if (!this.toolInfos || this.toolInfos.length === 0) {
            logger.error(`Tool Info Error`);
            this.events.emitEvent('infoData', {
                ...this.llmService.chatManager.chat,
                content: `Tool Info Error\n`,
                uuid: data.uuid,
            });
            this.triggerExternalHook('react_step_after', {
                query: data.query,
                uuid: data.uuid,
                status: 'no_message_output',
            });
            return false;
        }

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
            this.triggerExternalHook('react_step_after', {
                query: data.query,
                uuid: data.uuid,
                status: 'error',
                error_message,
            });
            return false;
        }

        const hasTool = this.toolInfos.some(t => t.tool_call_name);
        const hasError = this.toolInfos.some(t => t.error);

        if (hasTool || hasError) {
            this.llmService.chatManager.pushAssistantMessageWithToolCalls({
                ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid,
            });
        } else {
            this.llmService.chatManager.pushAssistantMessage({
                ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid,
            });
            this.events.emitEvent('streamData', {
                ...this.llmService.chatManager.chat, ...messageOutput, uuid: data.uuid, end: true,
            });
            this.state = State.FINAL;
            this.triggerExternalHook('react_step_after', {
                query: data.query,
                uuid: data.uuid,
                status: 'final_answer',
                has_tool: false,
            });
            return false;
        }

        let prevContent: string | undefined;
        let prevReasoningContent: string | undefined;

        for (let j = 0; j < this.toolInfos.length; j++) {
            const toolInfo = this.toolInfos[j];
            if (!toolInfo.tool_call_name) continue;

            this.currentToolInfo = toolInfo;

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

            if (toolInfo.error) {
                this.llmService.chatManager.pushToolMessage({
                    ...toolInfo, ...this.llmService.chatManager.chat, uuid: data.uuid,
                });
                this.events.emitEvent('streamData', {
                    ...this.llmService.chatManager.chat, content: toolInfo.error, uuid: data.uuid,
                });
                continue;
            }

            const ctx = new ExecutionContext(toolInfo, data);
            try {
                await this.pipeline.execute(ctx);
            } catch (err: any) {
                logger.error(`[Pipeline] Unhandled error for tool "${toolInfo.tool_call_name}":`, err);
            }

            // 🌟 核心拦截机制：若当前管道上下文返回挂起信号，或者 state 已经转换为 PAUSE，立刻强行拦截并返回中断标识
            if (ctx.suspendLoop || this.state === State.PAUSE) {
                this.state = State.PAUSE; // 强制校准状态机
                this.triggerExternalHook('react_step_after', {
                    query: data.query,
                    uuid: data.uuid,
                    status: 'paused',
                    tool_name: toolInfo.tool_call_name,
                });
                return true;
            }
        }

        const chat = this.llmService.chatManager.chat;
        if (chat.tokens >= chat.max_tokens) {
            this.llmAssistant.kvCacheSummary(data);
        }

        this.triggerExternalHook('react_step_after', {
            query: data.query,
            uuid: data.uuid,
            status: 'completed',
            tool_count: this.toolInfos.length,
        });

        return false;
    }

    public async getToolInfos(
        data: Record<string, any>,
        assistantMessage: AssistantMessage
    ): Promise<ToolInfo[]> {
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(
            this.llmService.chatManager.chat.tool_format
        );
        const toolInfos = adapter.getToolInfos(assistantMessage);

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

    public async act(toolInfo: ToolInfo): Promise<Observation> {
        let observation: Observation = { result: "" };
        let checkInterval: NodeJS.Timeout | null = null;

        this.triggerExternalHook('tool_call_before', {
            tool_name: toolInfo.tool_call_name,
            tool_call_id: toolInfo.tool_call_id,
            params: toolInfo.params,
        });

        try {
            if (
                !this.tool_schemas ||
                !this.tool_schemas.map(t => t.name).includes(toolInfo.tool_call_name)
            ) {
                return { result: "Tool does not exist." };
            }

            const will_tool = this.tools[toolInfo.tool_call_name as string].func;

            const stopWatcher = new Promise<never>((_, reject) => {
                checkInterval = setInterval(() => {
                    if (this.llmService.stopFlag) {
                        if (checkInterval) clearInterval(checkInterval);
                        reject(new Error("INTERRUPTED_BY_USER"));
                    }
                }, 300);
            });

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
                questions: response?.questions,
            };

        } catch (error: any) {
            // ✅ 核心修复：合并为一个健壮的错误捕获隔离区
            if (error?.message === "INTERRUPTED_BY_USER") {
                logger.log(`[ToolCall] Tool "${toolInfo.tool_call_name}" interrupted by user.`);
                observation = { result: "Execution stopped by user." };
            } else {
                console.error(error);
                observation = {
                    result: `Tool has been executed with error: ${error?.message || "Unknown operational crash."}`
                };
            }
        } finally {
            if (checkInterval) clearInterval(checkInterval);
            this.triggerExternalHook('tool_call_after', {
                tool_name: toolInfo.tool_call_name,
                tool_call_id: toolInfo.tool_call_id,
                params: toolInfo.params,
                observation,
            });
        }
        return observation!;
    }

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

        switch (toolInfo.tool_call_name) {
            case "display_file":
                this.events.emitEvent('streamData', {
                    ...chat, content: `\n\n${observation.result}`, uuid: data.uuid,
                });
                break;
            case "add_subtasks":
            case "record_subtasks":
            case "remove_tasks":
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
            if (observation.questions) {
                this.events.emitEvent('handleQuestions', {
                    ...chat, questions: observation.questions, uuid: data.uuid,
                });
            } else {
                this.events.emitEvent('streamData', {
                    ...chat, content: `\n\n${observation.ask || 'Please provide your input.'}`, uuid: data.uuid, end: true,
                });
            }
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

    public async callReAct(data: Record<string, any>, setUUID: boolean = true, skipInitialPush: boolean = false): Promise<any> {
        if (setUUID) this.setUUID(data);

        this.triggerExternalHook('react_loop_before', {
            query: data.query,
            skip_initial_push: skipInitialPush,
            set_uuid: setUUID,
        });

        const chat = this.llmService.chatManager.chat;

        if (this.state === State.PAUSE) {
            data.role = "tool";
            const context_id = `${chat.group_id}${chat.step - 1}`;
            this.llmService.chatManager.pushToolMessage({
                ...this.currentToolInfo, ...chat, context_id, content: data.query, uuid: data.uuid,
            });
            this.events.emitEvent('toolData', {
                ...chat, content: `\n\n---\n\n${data.query}`, uuid: data.uuid,
            });
        } else if (!skipInitialPush) {
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

            // 🌟 完美修复：捕获 step() 返回的强类型布尔断流标志
            const isSuspended = await this.step(data);

            // ✅ 使用 isSuspended 代替直接的 state 比较，或者使用类型断言 (this.state as any) 规避收窄
            if (isSuspended || (this.state as any) === State.PAUSE) {
                logger.log(`[ToolCall] ReAct loop suspended successfully on step ${chat.step} for human input.`);
                break; // 🛠️ 强行决裂，严禁执行下面的步数累加和后续迭代！
            }

            chat.seconds += (Date.now() / 1000 - t0);
            chat.step++;
            chat.context_id = `${chat.group_id}${chat.step}`;

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
        if (this.state === State.FINAL || (this.state as any) === State.ERROR) {
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

        this.triggerExternalHook('react_loop_after', {
            query: data.query,
            final_state: this.state,
            seconds: chat.seconds,
            step: chat.step,
        });

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
        // 按 max_display_messages 截断展示，防止加载卡顿
        // 截断消息用于前端显示：最后 max_display_messages 条 + 保底 user
        let displayMessages = messages;
        const N = this.llmService.chatManager.chat.max_display_messages;
        if (N > 0 && messages && messages.length > N) {
            displayMessages = messages.slice(-N);
            if (displayMessages[0].react || displayMessages[0].role !== "user") {
                const remaining = messages.slice(0, -N);
                for (let i = remaining.length - 1; i >= 0; i--) {
                    if (remaining[i].role === 'user' && remaining[i].react === false) {
                        let infoMessage: AssistantMessage = {
                            role: "assistant",
                            group_id: remaining[i].group_id,
                            context_id: remaining[i].context_id,
                            content: `⚠️ *[System Notice: To ensure loading performance, historical messages have been truncated. Only the most recent ${N} messages are currently displayed.]*`,
                            show: true,
                            react: true
                        };
                        displayMessages = [remaining[i], infoMessage, ...displayMessages];
                        break;
                    }
                }
            }
        }
        const chat = this.llmService.chatManager.chat;
        let state = State.IDLE;
        let questions = null;
        if (displayMessages.length > 0) {
            displayMessages.forEach((message, i) => {
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
                        case "remove_tasks":
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

                                const taskNumber = String(j).padStart(2, '0');
                                if (toolInfo.content || toolInfo.tool_call_name)
                                    this.events.emitEvent('streamData', {
                                        ...chat,
                                        ...message,
                                        content: `\n\n- 📋 **Tool ${taskNumber}** | ${toolInfo.content && (j === 0 || toolInfo.content !== toolInfos[0].content) ? toolInfo.content : toolInfo.tool_call_name}`,
                                        end: true
                                    });
                                if (["ask_user"].includes(toolInfo.tool_call_name as string)) {
                                    state = State.PAUSE;
                                    questions = toolInfo.params.questions
                                } else {
                                    state = State.RUNNING;
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
            } else {
                if (questions) {
                    this.state = state;
                    this.events.emitEvent('handleQuestions', {
                        ...chat, questions, end: true,
                    });
                }
            }
            this.changeMode(this.llmService.chatManager.chat.mode, false);
            logger.log(`Load success: ${filePath}`);
        }
        this.buildPipeline();
    }

    public loadChat(id: string): ChatState {
        if (this.llmService.chatManager.chat.id !== id) {
            this.initVar();
        }
        const history_path = this.utils.getHistoryPath(id);
        this.loadMessage(history_path, id);
        const historyChat = getHistoryChat(id);
        if (historyChat?.vars) {
            this.llmService.chatManager.chat.vars = historyChat.vars;
        }
        return this.llmService.chatManager.chat;
    }

    public newChat(id?: string): ChatState {
        this.events.emitEvent('clear');
        this.initVar();
        this.llmService.chatManager.chat.id = id || getSessionId();
        this.buildPipeline();
        this.setHistory(this.llmService.chatManager.chat);
        return this.llmService.chatManager.chat;
    }
}