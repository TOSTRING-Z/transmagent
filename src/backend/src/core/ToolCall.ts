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
    public toolInfo: ToolInfo | undefined;
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
            'ask_user': all(not(isSubagent), not(any(isMode('FLASH'), isMode('AUTO'))))
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
                // 依据原代码逻辑：PLAN 模式下，即便其他工具过了策略，最终也只有 ask_user 产出 Schema
                if (context.currentMode === context.modes.PLAN) {
                    return key === 'ask_user' ? schemaOrStr : null;
                }
                // 步骤 E: 数据格式化
                return typeof schemaOrStr === 'string'
                    ? { type: "raw_string", name: key, content: schemaOrStr }
                    : schemaOrStr;
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
        this.setHistory();
    }

    /**
     * AI 审查者逻辑 (LLM-as-a-Judge) - 缓存优化版
     */
    public async auditToolCall(toolInfo: ToolInfo, assistantMessage: Message, data: Record<string, any>): Promise<string | null> {
        const sensitiveTools = ['run_python', 'cli_execute', 'write_file', 'bash_execute'];
        if (!toolInfo.tool || !sensitiveTools.includes(toolInfo.tool) || !utils.getConfig("tool_call")?.llm_judge) {
            return null;
        }

        logger.log(`[Critic] 正在审查工具调用: ${toolInfo.tool}...`);

        const temp_llm_service = new LLMService();
        temp_llm_service.chatManager.chat = { ...this.llm_service.chatManager.chat };

        // 提取 tool_call_id，应对原生 API 的强校验
        const isNativeToolCall = assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0;
        const toolCallId = isNativeToolCall ? assistantMessage.tool_calls![0].id : (toolInfo.id || "dummy_id");

        temp_llm_service.chatManager.messages = [
            ...this.llm_service.chatManager.getMessages(true),
            assistantMessage
        ];

        // 核心修复点：如果存在原生 tool_calls，必须紧跟一条 tool 消息闭环
        if (isNativeToolCall) {
            temp_llm_service.chatManager.messages.push({
                role: "tool",
                content: "SYSTEM: Execution paused. Proceed to internal audit.",
                tool_call_id: toolCallId,
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
            this.toolInfo = await this.getToolInfo(data, assistantMessage);
        } else {
            return;
        }

        if (!this.toolInfo) {
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
        const currentThinking = this.toolInfo?.thinking;

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
        // 2. 拦截死循环并打断 (从原有 else 块中剥离)
        // ==========================================
        if (this.thinking_repetitions.length >= (utils.getConfig("tool_call")?.max_thinking_repetitions || 5)) {
            this.llm_service.chatManager.pushMessage(assistantMessage);
            let observation = {
                ask: `You have been stuck in a thinking loop ${this.thinking_repetitions.length} times. Try a new approach to break through, or end it directly.`,
                options: ["End Task", "Try New Approach", "Continue"]
            };
            const { ask, options } = observation;

            this.state = State.PAUSE;
            this.thinking_repetitions.length = 0; // 触发打断后清空历史，避免反复触发

            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: ask, end: true, chat: this.llm_service.chatManager.chat });
            this.window?.webContents.send("options", { options: options, group_id: this.llm_service.chatManager.chat.group_id, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool });

            return; // ⚠️ 关键拦截点：直接 return 终止当前步骤，不再执行下方的工具逻辑
        }

        // ==========================================
        // 3. 正常的工具执行流程 (完全解耦，不再被嵌套在重复判定中)
        // ==========================================
        if (this.toolInfo?.error) {
            this.llm_service.chatManager.pushMessage(assistantMessage);
            this.llm_service.chatManager.pushMessage({ role: "tool", content: this.toolInfo.error, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.toolInfo?.error, chat: this.llm_service.chatManager.chat });
        }
        else if (this.toolInfo?.tool) {
            this.llm_service.chatManager.pushMessage(assistantMessage);
            // [新增] 触发 AI 审查者，传入 assistantMessage 和 data 实现缓存命中
            let auditError = await this.auditToolCall(this.toolInfo, assistantMessage, data);

            if (auditError) {
                // 如果被拦截，将 Critic 的报错喂回给原 Agent
                this.llm_service.chatManager.pushMessage({
                    role: "tool",
                    content: auditError,
                    tool_call_id: this.toolInfo?.id,
                    tool_call_name: this.toolInfo?.tool,
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

                return; // 终止当前 step，带着失败观测进入下一轮思考
            }

            // [新增] 高风险工具确认逻辑 - 从配置文件读取
            const isHighRiskTool = this.isHighRiskTool(this.toolInfo.tool);
            const toolConfig = this.getToolConfig(this.toolInfo.tool);

            // 使用传入的windowManager
            if (isHighRiskTool && WindowManager.instance?.confirmationWindow && this.environment_details.mode === Mode.ACT) {
                // 从工具配置中检查是否需要确认
                const requireConfirmation = toolConfig?.require_confirmation !== false; // 默认需要确认

                if (requireConfirmation) {
                    // 获取工具描述和确认消息
                    let toolDescription = '';
                    const toolName = this.toolInfo.tool;

                    // 检查是否有已记住的选择
                    const rememberedChoice = this.getRememberedChoice(toolName);
                    if (rememberedChoice !== null) {
                        // 有记住的选择，直接执行或取消
                        if (rememberedChoice) {
                            let observation = await this.act(this.toolInfo!);
                            this.handleToolObservation(observation);
                        } else {
                            const cancelMessage = `用户取消了高风险工具 ${this.toolInfo!.tool} 的执行（已记住的选择）`;
                            this.llm_service.chatManager.pushMessage({
                                role: "tool",
                                content: cancelMessage,
                                tool_call_id: this.toolInfo?.id,
                                tool_call_name: this.toolInfo?.tool,
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                show: true,
                                react: true
                            });
                            this.window?.webContents.send('streamData', {
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                content: `❌ **执行取消**: ${cancelMessage}

`,
                                chat: this.llm_service.chatManager.chat
                            });
                        }
                        return; // 跳过确认窗口
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

                    // 显示确认窗口，使用配置中的确认消息
                    const finalConfirmationMessage = toolConfig?.confirmation_message || `即将执行高风险工具: ${toolName}`;

                    // 创建确认请求
                    const confirmationRequest = {
                        toolId: this.toolInfo?.id || '',
                        toolName: toolName,
                        toolDescription: toolDescription,
                        confirmationMessage: finalConfirmationMessage,
                        executionDetails: this.toolInfo.params
                    };

                    try {
                        // 显示确认窗口并等待用户响应
                        const response = await WindowManager.instance.confirmationWindow.showConfirmation(confirmationRequest);

                        // 如果用户选择记住选择，保存到配置
                        if (response.rememberChoice) {
                            this.setRememberedChoice(toolName, response.confirmed);
                        }

                        if (response.confirmed) {
                            // 用户确认后执行工具
                            let observation = await this.act(this.toolInfo!);
                            this.handleToolObservation(observation);
                        } else {
                            // 用户取消，返回取消信息
                            const cancelMessage = `用户取消了高风险工具 ${this.toolInfo!.tool} 的执行`;
                            this.llm_service.chatManager.pushMessage({
                                role: "tool",
                                content: cancelMessage,
                                tool_call_id: this.toolInfo?.id,
                                tool_call_name: this.toolInfo?.tool,
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                show: true,
                                react: true
                            });

                            this.window?.webContents.send('streamData', {
                                group_id: this.llm_service.chatManager.chat.group_id,
                                context_id: this.llm_service.chatManager.chat.context_id,
                                content: `❌ **执行取消**: ${cancelMessage}

`,
                                chat: this.llm_service.chatManager.chat
                            });
                        }
                    } catch (error) {
                        console.error("确认窗口错误:", error);
                        // 如果确认窗口出错，直接执行工具
                        let observation = await this.act(this.toolInfo!);
                        this.handleToolObservation(observation);
                    }

                    return; // 等待用户确认或取消
                }
            }

            let observation = await this.act(this.toolInfo!);
            this.handleToolObservation(observation);
        }
        else if (this.toolInfo?.thinking) {
            assistantMessage.react = false;
            this.llm_service.chatManager.pushMessage(assistantMessage);
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: null, end: true, chat: this.llm_service.chatManager.chat });
            this.state = State.FINAL;
        }
    }

    public async getToolInfo(data: Record<string, any>, assistantMessage): Promise<ToolInfo | undefined> {
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
        const toolInfo = adapter.getToolInfo(assistantMessage);
        if (!toolInfo.thinking && !toolInfo.tool) return; // 网络或内容容错处理
        let toolInfoStr = JSON.stringify(toolInfo, null, 2);
        data.output_format = toolInfoStr;
        this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(data) });
        this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: `${toolInfo.thinking}\n\n---\n\n`, chat: this.llm_service.chatManager.chat });
        return toolInfo;
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

    private handleToolObservation(observation: Observation): void {
        // 确保toolInfo存在
        if (!this.toolInfo) {
            console.error("toolInfo is undefined in handleToolObservation");
            return;
        }

        switch (this.toolInfo?.tool) {
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
            this.window?.webContents.send("options", { options: options, group_id: this.llm_service.chatManager.chat.group_id, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool });
        } else if (this.state === (State.FINAL as State)) {
            this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: observation, end: true, chat: this.llm_service.chatManager.chat });
        } else {
            this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
            // 这里需要获取当前的data，但data不在这个方法的上下文中
            // 我们可以创建一个默认的data对象或者从其他地方获取
            const defaultData = { output_format: observation.result };
            this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(defaultData) });
        }
    }

    public async callReAct(data: Record<string, any>): Promise<any> {
        if (this.state === State.PAUSE) {
            data.role = "tool";
            // 工具响应应和助手消息同一id
            let context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step - 1}`
            this.llm_service.chatManager.pushMessage({ role: "tool", content: data.query, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: context_id, show: true, react: true });
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