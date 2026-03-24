import * as os from 'os';
import { ReActAgent, State, Mode } from './ReActAgent';
import { utils, CHAT_CONST } from '../utils/globals';
import { formatString } from '../utils/format';
import { LLMService } from './LLMService';
import { Message, ToolInfo } from '../types';
import { MCPClient } from './McpClient';
import Prompts from './Prompts';
import MemoryManager from '../data/MemoryManager';
import getBaseTools from './base_tools';
import { ToolCallAdapterFactory } from '../factories/AdapterFactory';
import { IToolCallAdapter } from '../adapters/IAdapter';
import { Plugins } from './Plugins';
import { ToolDSL, Primitives } from "../utils/ToolDSL";
import { logger } from '../utils/logger';
import { WindowManager } from '../main/windows/WindowManager';
const { all, any, not, always } = ToolDSL;
const { isSubagent, isMode, hasArg } = Primitives;

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

export class ToolCall extends ReActAgent {
    public plugins: Plugins;
    public mcp_client: MCPClient;
    public prompt_args: PromptArgs;
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
    public current_context_id: number = 0;
    public memory_list: Message[] = [];
    public thinking_repetitions: (string | null)[] = [];
    public repetitions_delay_empty: number = 0;
    public environment_details!: EnvironmentDetails;
    public toolInfos: ToolInfo[] = [];
    public currentToolInfo: ToolInfo | undefined; // 用于记录当前执行的工具，方便 callReAct 等外部调用读取状态
    public modeMap: Record<string, Mode> = { "auto": Mode.AUTO, "plan": Mode.PLAN, "flash": Mode.FLASH, "act": Mode.ACT };
    private rememberedChoices: Record<string, boolean> = {};

    constructor(
        plugins: Plugins,
        agentTools: Record<string, any> = {},
        llm_service: LLMService,
        window: any,
        alertWindow: any,
        prompt_args: PromptArgs = {
            agent_prompt: null,
            mcp_server: true,
            todolist: true,
            subagent: false,
            agent_mode: "transagent"
        },
        windowManager?: any
    ) {
        super(llm_service, window, alertWindow);
        this.plugins = plugins;
        this.mcp_client = new MCPClient(this);
        this.prompt_args = prompt_args;
        this.windowManager = windowManager;

        this.initVar();

        this.baseTools = getBaseTools(this);
        this.agentTools = agentTools;
        this.tools = {};

        this.prompts = new Prompts(this);
        this.memory_manager = new MemoryManager(utils);

        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
    }

    public initVar() {
        this.state = State.IDLE;
        this.memory_list = [];
        this.thinking_repetitions = [];
        this.repetitions_delay_empty = 0;

        this.environment_details = {
            language: utils.getLanguage(),
            tmpdir: utils.getConfig("tool_call")?.tmpdir || os.tmpdir(),
            time: utils.formatDate(),
            mode: Mode.ACT,
            envs: null,
            todolist: null,
        };
    }

    /**
     * 检查工具是否为高风险工具
     * @param toolName 工具名称
     * @returns 是否为高风险工具
     */
    private isHighRiskTool(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.high_risk === true;
    }

    /**
     * 获取工具配置
     * @param toolName 工具名称
     * @returns 工具配置对象
     */
    private getToolConfig(toolName: string): any {
        if (!this.plugins) {
            return null;
        }

        const tool = this.plugins.getTool(toolName);
        if (tool && typeof tool === 'object') {
            return tool;
        }

        return null;
    }

    /**
     * 检查工具是否为敏感工具
     * @param toolName 工具名称
     * @returns 是否为敏感工具
     */
    private isSensitiveTool(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.sensitive_tool === true;
    }

    /**
     * 检查工具是否需要审计
     * @param toolName 工具名称
     * @returns 是否需要审计
     */
    private isToolRequireAudit(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.require_audit === true;
    }

    /**
     * 检查工具审计是否启用
     * @param toolName 工具名称
     * @returns 审计是否启用
     */
    private isToolAuditEnabled(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.audit_enabled === true;
    }

    public loadMessage(filePath: string) {
        super.loadMessage(filePath);
        this.changeMode(this.llm_service.chatManager.chat.mode);
    }

    public getToolsPrompt(): any {
        // --- 工具策略注册表 ---
        // 在这里声明每个工具在什么条件下允许被使用
        const TOOL_POLICY = {
            'mcp_server': all(hasArg('mcp_server'), not(isMode('PLAN'))),
            'add_subtasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
            'record_subtasks': all(hasArg('todolist'), not(any(isMode('PLAN'), isMode('FLASH')))),
            'context_retrieval': not(isSubagent),
            'search_long_term_memory': not(isSubagent),
            'write_important_memory': not(isSubagent),
            'ask_user': all(not(isSubagent), not(any(isMode('FLASH'), isMode('AUTO')))),
        };

        // --- 核心类方法中的逻辑 ---
        // 1. 工具与插件初始化 (保持原有逻辑)
        if (this.plugins && !this.prompt_args.subagent) {
            this.plugins.loadInit();
            this.tools = { ...this.plugins.getTool(), ...this.agentTools, ...this.baseTools };
        } else if (this.prompt_args.subagent) {
            this.tools = { ...this.agentTools, ...this.baseTools };
        }
        // 2. 组装上下文 (供 DSL 校验使用)
        const context = {
            args: this.prompt_args || {},
            env: this.environment_details || {},
            modes: Mode || {},
            isSubagent: !!this.prompt_args?.subagent,
            currentMode: this.environment_details?.mode
        };
        const format = this.llm_service.chatManager.chat.tool_format;
        // 3. 流水线处理：过滤 -> 提取Schema -> 格式化
        const tool_schemas = Object.entries(this.tools)
            .filter(([key, tool]) => {
                // 步骤 A: 基础校验 (是否有 getPrompt 方法，是否被显式禁用)
                if (!tool?.getPrompt) return false;
                if (tool.enabled === false && !context.isSubagent) return false;
                // 步骤 B: 策略校验 (查表执行 DSL 规则)
                const policy = TOOL_POLICY[key] || always; // 如果没有特殊配置，默认放行
                return policy(context);
            })
            .map(([key, tool]) => {
                // 步骤 C: 获取 Schema
                const schemaOrStr = tool.getPrompt();
                // 步骤 D: 特殊的全局模式拦截
                // 依据原代码逻辑：PLAN 模式下，即便其他工具过了策略，最终也只有 ask_user, list_dir, display_file, search_files 产出 Schema
                if (context.currentMode === context.modes.PLAN) {
                    return key === 'ask_user' || key === 'list_dir' || key === 'display_file' || key === 'search_files' ? schemaOrStr : null;
                }
                // 步骤 E: 数据格式化
                if (typeof schemaOrStr === 'string') {
                    return { type: "raw_string", name: key, content: schemaOrStr };
                }
                else if (Object.entries(schemaOrStr).length > 0) {
                    return schemaOrStr;
                } else {
                    logger.error(`Error tool.getPrompt(): ${key}`);
                }
            })
            .filter(Boolean); // 剔除 map 阶段可能产生的 null 值
        // 获取对应的适配器
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(format);
        // 执行格式化
        return adapter.formatTools(tool_schemas);
    }

    public async saveLongTermMemory(user_content: string, final_answer: string) {
        try {
            if (user_content && final_answer) {
                const time = this.environment_details.time;
                const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
                await this.memory_manager.addLongTermMemory(this.llm_service.chatManager.chat.id, content, time);
            }
        } catch (e: any) {
            console.error("Error saving memory", e);
        }
    }


    public memoryUpdate(data: Record<string, any>) {
        this.system_prompt = async () => {
            const important_memory = await this.memory_manager.getImportantMemory();
            const paramsToFormat = {
                system_type: utils.getConfig("tool_call")?.system_type || os.type(),
                system_platform: utils.getConfig("tool_call")?.system_platform || os.platform(),
                system_arch: utils.getConfig("tool_call")?.system_arch || os.arch(),
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
        this.environment_details.time = utils.formatDate();
        this.environment_details.language = data?.language || utils.getLanguage();
        const chatState = this.llm_service.chatManager.chat;

        const envs = Object.keys(chatState.envs || {}).map(key => `- ${key}: ${chatState.envs[key]}`);
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map((sub: any) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`);
            return `- ${task_id}: ${taskObj.task}:\n${subtasks.join("\n")}`;
        });

        this.environment_details.todolist = todolist.join("\n");
        this.environment_details.envs = envs.length > 0 ? envs.join("\n") : "[]";
        this.environment_details.skills = this.prompts.getSkillPrompt();

        if (utils.getConfig("tool_call")?.env_message) {
            data.env_message = this.llm_service.chatManager.envMessage(formatString(this.env_prompt, this.environment_details as any));
        } else {
            data.env_message = null;
        }
    }

    public changeMode(mode: string | null = null) {
        const selectedMode = this.modeMap[mode || ""] || Mode.ACT;
        const shortMode = this.modeMap[mode || ""] ? mode : "act";
        this.environment_details.mode = selectedMode;
        this.llm_service.chatManager.chat.mode = shortMode as string;
        if (!this.prompt_args.subagent) {
            this.setHistory();
        }
    }

    /**
     * AI 审查者逻辑 (LLM-as-a-Judge) - 隔离优化版
     */
    public async auditToolCall(toolInfo: ToolInfo, assistantMessage: Message, data: Record<string, any>): Promise<string | null> {
        // 1. 检查工具是否为敏感工具且需要审计
        if (!toolInfo.tool || !this.isSensitiveTool(toolInfo.tool) || !this.isToolRequireAudit(toolInfo.tool)) {
            return null;
        }

        // 2. 检查审计是否启用
        if (!this.isToolAuditEnabled(toolInfo.tool)) {
            logger.log(`[Critic] 工具 ${toolInfo.tool} 审计已禁用，跳过审查`);
            return null;
        }

        // 3. 检查LLM审查器是否启用
        if (!utils.getConfig("tool_call")?.llm_judge) {
            return null;
        }

        logger.log(`[Critic] 正在审查敏感工具调用: ${toolInfo.tool} (ID: ${toolInfo.id})...`);

        const temp_llm_service = new LLMService();
        temp_llm_service.chatManager.chat = { ...this.llm_service.chatManager.chat };

        // ==========================================
        // 关键修复：构建隔离的助手消息，剔除并发的其他工具
        // ==========================================
        const isolatedAssistantMessage: Message = { ...assistantMessage };
        const isNativeToolCall = isolatedAssistantMessage.tool_calls && isolatedAssistantMessage.tool_calls.length > 0;

        if (isNativeToolCall) {
            // [原生 API 模式] 只保留当前正在审查的这一个 tool_call
            isolatedAssistantMessage.tool_calls = isolatedAssistantMessage.tool_calls!.filter(
                call => call.id === toolInfo.id
            );

            // 容错：如果没匹配上（理论上不可能），直接赋一个单元素数组
            if (isolatedAssistantMessage.tool_calls.length === 0) {
                isolatedAssistantMessage.tool_calls = [{
                    id: toolInfo.id || "dummy_id",
                    type: "function",
                    function: {
                        name: toolInfo.tool,
                        arguments: JSON.stringify(toolInfo.params)
                    }
                }];
            }
        } else {
            // [Prompt 模式] 原始 content 可能是包含多个对象的 JSON 数组
            // 重构 content，确保审查者只看到当前的单一工具负载
            const isolatedPayload = {
                thinking: toolInfo.thinking,
                tool: toolInfo.tool,
                params: toolInfo.params
            };
            isolatedAssistantMessage.content = JSON.stringify(isolatedPayload, null, 2);
        }

        // 组装审查上下文
        temp_llm_service.chatManager.messages = [
            ...this.llm_service.chatManager.getMessages(true),
            isolatedAssistantMessage
        ];

        // 闭环假消息：针对原生 API 补充单一的工具回复
        if (isNativeToolCall) {
            temp_llm_service.chatManager.messages.push({
                role: "tool",
                content: "SYSTEM: Execution paused. Proceed to internal audit.",
                tool_call_id: toolInfo.id || "dummy_id",
                tool_call_name: toolInfo.tool,
                group_id: assistantMessage.group_id,
                context_id: assistantMessage.context_id
            });
        }

        const critic_agent = new ReActAgent(temp_llm_service);

        // 利用 System Override 强行扭转模型视角
        const criticQuery = `
[SYSTEM OVERRIDE: INTERNAL AUDIT PROTOCOL]
You must now pause your current task and act as a strict Data Integrity Critic. 
Review the tool call payload you just generated above.

# OBJECTIVE:
Distinguish between "Developing Tools/Scripts" (Allowed) and "Hallucinating Final Data" (Blocked).

# CRITICAL CHECK CRITERIA:
* ALLOWED (Pass = true): 
  - Writing scripts to query APIs, scrape websites, or parse local files.
  - Using placeholders for credentials (e.g., 'YOUR_API_KEY', 'TEMP_TOKEN').
  - Creating boilerplate code or skeleton functions intended to be executed for real data retrieval.
  - Mocking structure for testing logic flow, UNLESS it replaces a factual data source.

* BLOCKED (Pass = false): 
  - Hardcoding factual/scientific results (e.g., specific protein sequences, GPS coordinates, experimental values) instead of writing code to fetch them.
  - Using random number generators (e.g., \`random.random()\`) to simulate analytical results.
  - Providing a "mock response" script that prints hardcoded fake data to bypass an actual API/Tool requirement.

# OUTPUT FORMAT:
You MUST respond ONLY with a valid JSON object. DO NOT call any tools.
{
  "pass": boolean,
  "reason": "If false, state EXACTLY which specific data point was mocked and how it should be correctly fetched."
}
        `.trim();

        const callData = critic_agent.getDataDefault({
            ...data,
            query: criticQuery,
            push_message: true,
            output_format: null
        });

        try {
            if (!callData.params) callData.params = {};
            callData.params.llm_params = {
                ...callData.params.llm_params,
                temperature: 0.1,
                tool_choice: "none",
                response_format: { type: "json_object" }
            };

            const messageOutput = await critic_agent.llmCall(callData);

            if (messageOutput && messageOutput.content) {
                const resultStr = messageOutput.content as string;
                const jsonMatch = resultStr.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    const verdict = JSON.parse(jsonMatch[0]);
                    if (verdict.pass === false) {
                        logger.log(`[Critic] 拦截成功! 发现伪造数据: ${verdict.reason}`);
                        return `[CRITIC REJECTION] Execution Blocked. Your payload violates data integrity rules:\nReason: ${verdict.reason}`;
                    }
                }
            }
        } catch (error) {
            console.error("[Critic] 审查过程发生异常，默认放行:", error);
        }

        return null;
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

        if (!this.mcp_prompt && this.prompt_args.mcp_server) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcpPrompt;
        }

        data.push_message = false;

        this.environmentUpdate(data);
        this.memoryUpdate(data);

        data.prompt = await this.system_prompt();
        const messageOutput = await this.llmCall(data);
        let assistantMessage!: Message;

        if (messageOutput) {
            assistantMessage = { ...messageOutput, ...{ group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, tool_format: this.llm_service.chatManager.chat.tool_format, show: true, react: true } }
            this.toolInfos = await this.getToolInfos(data, assistantMessage);
        } else {
            return;
        }

        if (!this.toolInfos || this.toolInfos.length === 0) {
            logger.error(`Tool Info Error`);
            this.window?.webContents.send('infoData', {
                group_id: this.llm_service.chatManager.chat.group_id,
                content: `Tool Info Error\n`
            });
            return
        }; // 容错处理

        // ==========================================
        // 1. 记录与判断重复思考
        // ==========================================
        const currentThinking = this.toolInfos[0]?.thinking;

        // 与上一次思考内容对比，而不是第一次
        if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[this.thinking_repetitions.length - 1] === currentThinking) {
            this.thinking_repetitions.push(currentThinking);
            this.repetitions_delay_empty = 0; // 如果重复，重置容错延迟计数
        } else {
            this.repetitions_delay_empty += 1;
            // 超过容错次数，清空记录并以当前的思考作为新的起点
            if (this.repetitions_delay_empty >= (utils.getConfig("tool_call")?.repetitions_delay_empty || 1)) {
                this.thinking_repetitions = [currentThinking];
                this.repetitions_delay_empty = 0;
            }
        }

        // ==========================================
        // 2. 先把包含所有 tool_calls 的助手消息压入历史记录 (只压一次！)
        // ==========================================
        const hasTool = this.toolInfos.some(t => t.tool);
        const isThinkingOnly = this.toolInfos.length === 1 && !this.toolInfos[0].tool;

        if (hasTool || isThinkingOnly) {
            this.llm_service.chatManager.pushMessage(assistantMessage);
        }

        // 纯思考结束流程
        if (isThinkingOnly) {
            assistantMessage.react = false;
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: null, end: true, chat: this.llm_service.chatManager.chat });
            this.state = State.FINAL;
            return;
        }

        // ==========================================
        // 3. 循环并发遍历所有工具 (依次执行，确保上下文有序)
        // ==========================================
        for (const toolInfo of this.toolInfos) {
            if (!toolInfo.tool) continue;

            this.currentToolInfo = toolInfo; // 更新当前状态引用，供 callReAct 等外部断点恢复使用

            // [1. 解析错误处理]
            if (toolInfo.error) {
                this.llm_service.chatManager.pushMessage({
                    role: "tool",
                    content: toolInfo.error,
                    tool_call_id: toolInfo.id,
                    tool_call_name: toolInfo.tool,
                    group_id: this.llm_service.chatManager.chat.group_id,
                    context_id: this.llm_service.chatManager.chat.context_id,
                    show: true,
                    react: true
                });
                this.window?.webContents.send('streamData', {
                    group_id: this.llm_service.chatManager.chat.group_id,
                    context_id: this.llm_service.chatManager.chat.context_id,
                    content: toolInfo.error,
                    chat: this.llm_service.chatManager.chat
                });
                continue; // 当前工具执行失败，继续尝试数组中的下一个工具
            }

            // [2. 触发 AI 审查者 (Critic)]
            let auditError = await this.auditToolCall(toolInfo, assistantMessage, data);
            if (auditError) {
                // 如果被拦截，将 Critic 的报错喂回给原 Agent
                this.llm_service.chatManager.pushMessage({
                    role: "tool",
                    content: auditError,
                    tool_call_id: toolInfo.id,
                    tool_call_name: toolInfo.tool,
                    group_id: this.llm_service.chatManager.chat.group_id,
                    context_id: this.llm_service.chatManager.chat.context_id,
                    show: true,
                    react: true
                });

                this.window?.webContents.send('streamData', {
                    group_id: this.llm_service.chatManager.chat.group_id,
                    context_id: this.llm_service.chatManager.chat.context_id,
                    content: `⚠️ **Security Intercept**: ${auditError}\n\n`,
                    chat: this.llm_service.chatManager.chat
                });

                continue; // 终止当前风险工具，继续执行数组中下一个工具
            }

            // [3. 高风险工具确认逻辑]
            const isHighRiskTool = this.isHighRiskTool(toolInfo.tool);
            const toolConfig = this.getToolConfig(toolInfo.tool);

            if (isHighRiskTool && WindowManager.instance?.confirmationWindow && this.environment_details.mode === Mode.ACT) {
                const requireConfirmation = toolConfig?.require_confirmation !== false; // 默认需要确认

                if (requireConfirmation) {
                    let toolDescription = '';
                    const toolName = toolInfo.tool;

                    // 检查是否有已记住的选择
                    const rememberedChoice = this.getRememberedChoice(toolName);
                    if (rememberedChoice !== null) {
                        if (rememberedChoice) {
                            let observation = await this.act(toolInfo);
                            this.handleToolObservation(observation, toolInfo);
                        } else {
                            const cancelMessage = `用户取消了高风险工具 ${toolInfo.tool} 的执行（已记住的选择）`;
                            this.llm_service.chatManager.pushMessage({
                                role: "tool",
                                content: cancelMessage,
                                tool_call_id: toolInfo.id,
                                tool_call_name: toolInfo.tool,
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                show: true,
                                react: true
                            });
                            this.window?.webContents.send('streamData', {
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                content: `❌ **执行取消**: ${cancelMessage}\n\n`,
                                chat: this.llm_service.chatManager.chat
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
                        toolId: toolInfo.id || '',
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
                            this.handleToolObservation(observation, toolInfo);
                        } else {
                            const cancelMessage = `用户取消了高风险工具 ${toolInfo.tool} 的执行`;
                            this.llm_service.chatManager.pushMessage({
                                role: "tool",
                                content: cancelMessage,
                                tool_call_id: toolInfo.id,
                                tool_call_name: toolInfo.tool,
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                show: true,
                                react: true
                            });

                            this.window?.webContents.send('streamData', {
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                content: `❌ **执行取消**: ${cancelMessage}\n\n`,
                                chat: this.llm_service.chatManager.chat
                            });
                        }
                    } catch (error) {
                        console.error("确认窗口错误:", error);
                        // 如果确认窗口本身出错（IPC 崩溃等），默认放行执行
                        let observation = await this.act(toolInfo);
                        this.handleToolObservation(observation, toolInfo);
                    }

                    // 状态机流转：如果弹窗后执行的工具（或回调）让状态变成了暂停，直接跳出并发循环
                    if (this.state === State.PAUSE) break;
                    continue; // 处理完毕当前高风险工具，进行下一个
                }
            }

            // [4. 标准工具安全执行]
            let observation = await this.act(toolInfo);
            this.handleToolObservation(observation, toolInfo);

            // [关键防御点]：如果当前工具（例如 ask_user）需要挂起等待用户回复，必须立刻阻断后续工具的并发执行
            if (this.state === State.PAUSE) {
                break;
            }
        }
    }

    public async getToolInfos(data: Record<string, any>, assistantMessage: any): Promise<ToolInfo[]> {
        const adapter: any = ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
        const toolInfos = adapter.getToolInfos(assistantMessage);

        // 网络或内容容错处理
        if (toolInfos.length === 1 && !toolInfos[0].thinking && !toolInfos[0].tool) return [];

        let toolInfoStr = JSON.stringify(toolInfos, null, 2);
        data.output_format = toolInfoStr;

        this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(data) });

        const thinking = toolInfos[0]?.thinking || "";
        if (thinking) {
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: `${thinking}\n\n---\n\n`, chat: this.llm_service.chatManager.chat });
        }

        return toolInfos;
    }

    public async act(toolInfo: ToolInfo): Promise<Observation> {
        let observation: Observation;
        try {
            if (!this.tools || !Object.prototype.hasOwnProperty.call(this.tools, toolInfo.tool as string)) {
                observation = {
                    result: "Tool does not exist."
                };
            }
            const will_tool = this.tools[toolInfo.tool as string].func;
            const response = await will_tool(toolInfo?.params);
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
            console.error(error);
            observation = {
                result: `Tool has been executed with error: ${error.message}`
            };
        }
        return observation;
    }

    private handleToolObservation(observation: Observation, toolInfo: ToolInfo): void {
        // 确保toolInfo存在
        if (!toolInfo) {
            console.error("toolInfo is undefined in handleToolObservation");
            return;
        }

        switch (toolInfo?.tool) {
            case "display_file":
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: `${observation.result}\n\n`, chat: this.llm_service.chatManager.chat });
                break;
            case "add_subtasks":
            case "record_subtasks":
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: `\`\`\`json\n${observation.result}\n\`\`\`\n\n`, chat: this.llm_service.chatManager.chat });
                break;
        }

        if (observation.subagent_tool) {
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: observation.result, end: false, chat: this.llm_service.chatManager.chat });
        }

        if (this.state === (State.PAUSE as State)) {
            const { ask, options } = observation;
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: ask, end: true, chat: this.llm_service.chatManager.chat });
            this.window?.webContents.send("options", { options: options, group_id: this.llm_service.chatManager.chat.group_id, tool_call_id: toolInfo?.id, tool_call_name: toolInfo?.tool });
        } else if (this.state === (State.FINAL as State)) {
            this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: toolInfo?.id, tool_call_name: toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: observation, end: true, chat: this.llm_service.chatManager.chat });
        } else {
            this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: toolInfo?.id, tool_call_name: toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
            // 这里需要获取当前的data，但data不在这个方法的上下文中
            // 我们可以创建一个默认的data对象或者从其他地方获取
            const defaultData = { output_format: observation.result };
            this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(defaultData) });
        }
    }

    public async callReAct(data: Record<string, any>): Promise<any> {
        if (this.state === State.PAUSE) {
            data.role = "tool";
            let context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step - 1}`
            this.llm_service.chatManager.pushMessage({
                role: "tool",
                content: data.query,
                tool_call_id: this.currentToolInfo?.id,
                tool_call_name: this.currentToolInfo?.tool,
                group_id: this.llm_service.chatManager.chat.group_id,
                context_id: context_id,
                show: true,
                react: true
            });
            this.window.webContents.send('toolData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: data.query, del: false });
        } else {
            this.llm_service.chatManager.chat.step = 1;
            this.llm_service.chatManager.chat.group_id = String((new Date()).getTime());
            this.llm_service.chatManager.chat.context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step}`
            data.role = "user";
            this.llm_service.chatManager.fixMessages();
            this.llm_service.chatManager.pushMessage({ role: "user", content: data.query, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: false });
            this.window.webContents.send('userData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: data.query, del: false });
        }

        this.state = State.IDLE;
        let tool_call = utils.getConfig("tool_call");

        while (this.state === State.IDLE || this.state === State.RUNNING) {
            // 延时1s，避免过快进入死循环
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.llm_service.stopFlag) {
                this.state = State.FINAL;
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, content: "The user interrupted the task.", end: true, chat: this.llm_service.chatManager.chat });
                break;
            }
            if (data?.max_step && this.llm_service.chatManager.chat.step > data.max_step) break;
            data = { ...data, ...tool_call, step: this.llm_service.chatManager.chat.step, tools: this.getToolsPrompt(), react: true };

            await this.step(data);

            this.llm_service.chatManager.chat.step++;
            this.llm_service.chatManager.chat.context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step}`

            const currentChatName = this.llm_service.chatManager.chat.name;
            if (!currentChatName || currentChatName === CHAT_CONST.DEFAULT_NAME) {
                await this.setChatName(data).then(() => {
                    if (this.llm_service.chatManager.chat.name && this.llm_service.chatManager.chat.name !== CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('auto-rename-chat', this.llm_service.chatManager.chat);
                    }
                });
            }

            if (!this.prompt_args.subagent) {
                this.setHistory();
            }
        }

        if (this.state === State.FINAL) {
            if (!this.prompt_args.subagent) {
                this.setHistory();
            }
        }

        if (!this.prompt_args.subagent) {
            this.sendData(data);
        }
        return data;
    }
}