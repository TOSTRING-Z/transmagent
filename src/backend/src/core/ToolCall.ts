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
    agent_mode?: string;
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
    public toolInfo!: ToolInfo;
    public modeMap: Record<string, Mode> = { "auto": Mode.AUTO, "plan": Mode.PLAN, "flash": Mode.FLASH, "act": Mode.ACT };

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
        }
    ) {
        super(llm_service, window, alertWindow);
        this.plugins = plugins;
        this.mcp_client = new MCPClient(this);
        this.prompt_args = prompt_args;

        this.init_var();

        this.baseTools = getBaseTools(this);
        this.agentTools = agentTools;
        this.tools = {};

        this.prompts = new Prompts(this);
        this.memory_manager = new MemoryManager(utils);

        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
    }

    public init_var() {
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

    public load_message(filePath: string) {
        super.load_message(filePath);
        this.change_mode(this.llm_service.chatManager.chat.mode);
    }

    public get_tools_prompt(): any {
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
            this.plugins.init();
            this.tools = { ...this.plugins.getTool(), ...this.agentTools, ...this.baseTools };
        } else if (this.prompt_args.subagent) {
            this.tools = this.agentTools;
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

    public async save_long_term_memory(user_content: string, final_answer: string) {
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

    public memory_update(data: Record<string, any>) {
        let messages = this.llm_service.chatManager.getMessages(false);
        let messages_list: Message[] = [];

        if (messages.length > data.memory_length) {
            const startIdx = Math.max(messages.length - data.long_memory_length - data.memory_length, 0);
            messages_list = messages.slice(startIdx, messages.length - data.memory_length).map(message => {
                const message_copy = this.llm_service.chatManager.delMessage(message, message?.del);
                return {
                    role: message_copy.role,
                    content: message_copy.content,
                    context_id: message_copy.context_id,
                };
            });
        }

        this.memory_list = messages_list;

        this.system_prompt = async () => {
            const important_memory = await this.memory_manager.getImportantMemory();
            const paramsToFormat = {
                system_type: utils.getConfig("tool_call")?.system_type || os.type(),
                system_platform: utils.getConfig("tool_call")?.system_platform || os.platform(),
                system_arch: utils.getConfig("tool_call")?.system_arch || os.arch(),
                mcp_prompt: this.mcp_prompt,
                cli_prompt: this.prompts.getCliPrompt(),
                extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt),
                important_memory: important_memory,
                memory_list: JSON.stringify(this.memory_list, null, 2)
            }
            const systemPrompt = formatString(this.task_prompt(data.tools), paramsToFormat);
            return systemPrompt.replaceAll(/\n{2,}/g, "\n\n").trim();
        }
    }

    public environment_update(data: Record<string, any>) {
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

    public change_mode(mode: string | null = null) {
        const selectedMode = this.modeMap[mode || ""] || Mode.ACT;
        const shortMode = this.modeMap[mode || ""] ? mode : "act";
        this.environment_details.mode = selectedMode;
        this.llm_service.chatManager.chat.mode = shortMode as string;
        this.window?.webContents.send('change-mode', shortMode);
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

# CRITICAL CHECK:
Did you write "mock data", "placeholder", use random number generators, or hardcode biological data/coordinates instead of writing code to fetch and parse REAL data? Are you creating fake files for demonstration purposes?

# OUTPUT FORMAT:
You MUST respond ONLY with a valid JSON object. DO NOT call any tools.
{
  "pass": boolean, // true if the code genuinely processes real data, false if it hallucinates or mocks data.
  "reason": "If false, state EXACTLY what is mocked and how to fix it."
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
            callData.params.llm_params = { ...callData.params.llm_params, temperature: 0.1, tool_choice: "none" };

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

    public async step(data: Record<string, any>) {
        if (this.state === State.IDLE) {
            this.state = State.RUNNING;
        }

        if (!this.mcp_prompt && this.prompt_args.mcp_server) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcpPrompt;
        }

        data.push_message = false;

        this.environment_update(data);
        this.memory_update(data);

        data.prompt = await this.system_prompt();
        const messageOutput = await this.llmCall(data);
        let assistantMessage!: Message;
        if (messageOutput) {
            assistantMessage = { ...messageOutput, ...{ group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, tool_format: this.llm_service.chatManager.chat.tool_format, show: true, react: true } }
            this.toolInfo = await this.getToolInfo(data, assistantMessage);
        }

        if (!this.toolInfo) return; // 容错处理

        // ==========================================
        // 1. 记录与判断重复思考
        // ==========================================
        const currentThinking = this.toolInfo.thinking;

        // 与上一次思考内容对比，而不是第一次
        if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[this.thinking_repetitions.length - 1] === currentThinking) {
            this.thinking_repetitions.push(currentThinking);
            this.repetitions_delay_empty = 0; // 如果重复，重置容错延迟计数
        } else {
            this.repetitions_delay_empty += 1;
            // 超过容错次数，清空记录并以当前的思考作为新的起点
            if (this.repetitions_delay_empty >= (utils.getConfig("tool_call")?.repetitions_delay_empty || 2)) {
                this.thinking_repetitions = [currentThinking];
                this.repetitions_delay_empty = 0;
            }
        }

        // ==========================================
        // 2. 拦截死循环并打断 (从原有 else 块中剥离)
        // ==========================================
        if (this.thinking_repetitions.length >= (utils.getConfig("tool_call")?.max_thinking_repetitions || 3)) {
            let observation = {
                ask: `You have been stuck in a thinking loop ${this.thinking_repetitions.length} times. Try a new approach to break through, or end it directly.`,
                options: ["End Task", "Try New Approach", "Continue"]
            };
            const { ask, options } = observation;

            this.state = State.PAUSE;
            this.thinking_repetitions.length = 0; // 触发打断后清空历史，避免反复触发

            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: ask, end: true, chat: this.llm_service.chatManager.chat });
            this.window?.webContents.send("options", { options: options, group_id: this.llm_service.chatManager.chat.group_id, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, is_tool_response: true });

            return; // ⚠️ 关键拦截点：直接 return 终止当前步骤，不再执行下方的工具逻辑
        }

        // ==========================================
        // 3. 正常的工具执行流程 (完全解耦，不再被嵌套在重复判定中)
        // ==========================================
        if (this.toolInfo?.error) {
            this.llm_service.chatManager.pushMessage(assistantMessage);
            this.llm_service.chatManager.pushMessage({ role: "tool", content: this.toolInfo.error, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.toolInfo.error, chat: this.llm_service.chatManager.chat });
        }
        else if (this.toolInfo?.tool) {
            // [新增] 触发 AI 审查者，传入 assistantMessage 和 data 实现缓存命中
            let auditError = await this.auditToolCall(this.toolInfo, assistantMessage, data);

            if (auditError) {
                // 如果被拦截，将 Critic 的报错喂回给原 Agent
                this.llm_service.chatManager.pushMessage(assistantMessage); // 必须保存原造假调用，否则它不知道错了什么

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

            this.llm_service.chatManager.pushMessage(assistantMessage);
            let observation = await this.act(this.toolInfo);

            switch (this.toolInfo.tool) {
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

            data.output_format = observation.result;

            if (this.state === (State.PAUSE as State)) {
                const { ask, options } = observation;
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: ask, end: true, chat: this.llm_service.chatManager.chat });
                this.window?.webContents.send("options", { options: options, group_id: this.llm_service.chatManager.chat.group_id, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, is_tool_response: true });
            } else if (this.state === (State.FINAL as State)) {
                this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: observation, end: true, chat: this.llm_service.chatManager.chat });
            } else {
                this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
                this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(data) });
            }
        }
        else if (this.toolInfo?.thinking) {
            assistantMessage.react = false;
            this.llm_service.chatManager.pushMessage(assistantMessage);
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: null, end: true, chat: this.llm_service.chatManager.chat });
            this.state = State.FINAL;
        }
    }

    public async getToolInfo(data: Record<string, any>, assistantMessage): Promise<ToolInfo> {
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
        const toolInfo = adapter.getToolInfo(assistantMessage);
        let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("\\`", "'").replaceAll("`", "'");
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
            data = { ...data, ...tool_call, step: this.llm_service.chatManager.chat.step, tools: this.get_tools_prompt(), react: true };

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