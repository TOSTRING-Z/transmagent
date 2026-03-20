"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolCall = void 0;
const os = __importStar(require("os"));
const ReActAgent_1 = require("./ReActAgent");
const globals_1 = require("../utils/globals");
const format_1 = require("../utils/format");
const LLMService_1 = require("./LLMService");
const McpClient_1 = require("./McpClient");
const Prompts_1 = __importDefault(require("./Prompts"));
const MemoryManager_1 = __importDefault(require("../data/MemoryManager"));
const base_tools_1 = __importDefault(require("./base_tools"));
const AdapterFactory_1 = require("../factories/AdapterFactory");
const ToolDSL_1 = require("../utils/ToolDSL");
const logger_1 = require("../utils/logger");
const { all, any, not, always } = ToolDSL_1.ToolDSL;
const { isSubagent, isMode, hasArg } = ToolDSL_1.Primitives;
class ToolCall extends ReActAgent_1.ReActAgent {
    plugins;
    mcp_client;
    prompt_args;
    system_prompt;
    mcp_prompt;
    tools;
    baseTools;
    agentTools;
    prompts;
    memory_manager;
    task_prompt;
    env_prompt;
    current_context_id = 0;
    memory_list = [];
    thinking_repetitions = [];
    repetitions_delay_empty = 0;
    environment_details;
    toolInfo;
    modeMap = { "auto": ReActAgent_1.Mode.AUTO, "plan": ReActAgent_1.Mode.PLAN, "flash": ReActAgent_1.Mode.FLASH, "act": ReActAgent_1.Mode.ACT };
    constructor(plugins, agentTools = {}, llm_service, window, alertWindow, prompt_args = {
        agent_prompt: null,
        mcp_server: true,
        todolist: true,
        subagent: false,
        agent_mode: "transagent"
    }) {
        super(llm_service, window, alertWindow);
        this.plugins = plugins;
        this.mcp_client = new McpClient_1.MCPClient(this);
        this.prompt_args = prompt_args;
        this.initVar();
        this.baseTools = (0, base_tools_1.default)(this);
        this.agentTools = agentTools;
        this.tools = {};
        this.prompts = new Prompts_1.default(this);
        this.memory_manager = new MemoryManager_1.default(globals_1.utils);
        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
    }
    initVar() {
        this.state = ReActAgent_1.State.IDLE;
        this.memory_list = [];
        this.thinking_repetitions = [];
        this.repetitions_delay_empty = 0;
        this.environment_details = {
            language: globals_1.utils.getLanguage(),
            tmpdir: globals_1.utils.getConfig("tool_call")?.tmpdir || os.tmpdir(),
            time: globals_1.utils.formatDate(),
            mode: ReActAgent_1.Mode.ACT,
            envs: null,
            todolist: null,
        };
    }
    loadMessage(filePath) {
        super.loadMessage(filePath);
        this.changeMode(this.llm_service.chatManager.chat.mode);
    }
    getToolsPrompt() {
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
        }
        else if (this.prompt_args.subagent) {
            this.tools = { ...this.agentTools, ...this.baseTools };
        }
        // 2. 组装上下文 (供 DSL 校验使用)
        const context = {
            args: this.prompt_args || {},
            env: this.environment_details || {},
            modes: ReActAgent_1.Mode || {},
            isSubagent: !!this.prompt_args?.subagent,
            currentMode: this.environment_details?.mode
        };
        const format = this.llm_service.chatManager.chat.tool_format;
        // 3. 流水线处理：过滤 -> 提取Schema -> 格式化
        const tool_schemas = Object.entries(this.tools)
            .filter(([key, tool]) => {
            // 步骤 A: 基础校验 (是否有 getPrompt 方法，是否被显式禁用)
            if (!tool?.getPrompt)
                return false;
            if (tool.enabled === false && !context.isSubagent)
                return false;
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
        const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(format);
        // 执行格式化
        return adapter.formatTools(tool_schemas);
    }
    async saveLongTermMemory(user_content, final_answer) {
        try {
            if (user_content && final_answer) {
                const time = this.environment_details.time;
                const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
                await this.memory_manager.addLongTermMemory(this.llm_service.chatManager.chat.id, content, time);
            }
        }
        catch (e) {
            console.error("Error saving memory", e);
        }
    }
    memoryUpdate(data) {
        let messages = this.llm_service.chatManager.getMessages(false);
        let messages_list = [];
        if (messages.length > data.memory_length) {
            let startIdx = Math.floor(messages.length / data.memory_length) * data.memory_length;
            let longStartIdx = Math.max(startIdx - data.long_memory_length, 0);
            messages_list = messages.slice(longStartIdx, startIdx).filter(message => message.role !== "tool").map(message => {
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
                system_type: globals_1.utils.getConfig("tool_call")?.system_type || os.type(),
                system_platform: globals_1.utils.getConfig("tool_call")?.system_platform || os.platform(),
                system_arch: globals_1.utils.getConfig("tool_call")?.system_arch || os.arch(),
                mcp_prompt: this.mcp_prompt,
                cli_prompt: this.prompts.getCliPrompt(),
                extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt),
                skill_prompt: this.prompts.getSkillPrompt(),
                important_memory: important_memory,
                memory_list: JSON.stringify(this.memory_list, null, 2)
            };
            const systemPrompt = (0, format_1.formatString)(this.task_prompt(data.tools), paramsToFormat);
            return systemPrompt.replaceAll(/\n{2,}/g, "\n\n").trim();
        };
    }
    environmentUpdate(data) {
        this.environment_details.time = globals_1.utils.formatDate();
        this.environment_details.language = data?.language || globals_1.utils.getLanguage();
        const chatState = this.llm_service.chatManager.chat;
        const envs = Object.keys(chatState.envs || {}).map(key => `- ${key}: ${chatState.envs[key]}`);
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map((sub) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`);
            return `- ${task_id}: ${taskObj.task}:\n${subtasks.join("\n")}`;
        });
        this.environment_details.todolist = todolist.join("\n");
        this.environment_details.envs = envs.length > 0 ? envs.join("\n") : "[]";
        this.environment_details.skills = this.prompts.getSkillPrompt();
        if (globals_1.utils.getConfig("tool_call")?.env_message) {
            data.env_message = this.llm_service.chatManager.envMessage((0, format_1.formatString)(this.env_prompt, this.environment_details));
        }
        else {
            data.env_message = null;
        }
    }
    changeMode(mode = null) {
        const selectedMode = this.modeMap[mode || ""] || ReActAgent_1.Mode.ACT;
        const shortMode = this.modeMap[mode || ""] ? mode : "act";
        this.environment_details.mode = selectedMode;
        this.llm_service.chatManager.chat.mode = shortMode;
        this.setHistory();
    }
    /**
     * AI 审查者逻辑 (LLM-as-a-Judge) - 缓存优化版
     */
    async auditToolCall(toolInfo, assistantMessage, data) {
        const sensitiveTools = ['run_python', 'cli_execute', 'write_file', 'bash_execute'];
        if (!toolInfo.tool || !sensitiveTools.includes(toolInfo.tool) || !globals_1.utils.getConfig("tool_call")?.llm_judge) {
            return null;
        }
        logger_1.logger.log(`[Critic] 正在审查工具调用: ${toolInfo.tool}...`);
        const temp_llm_service = new LLMService_1.LLMService();
        temp_llm_service.chatManager.chat = { ...this.llm_service.chatManager.chat };
        // 提取 tool_call_id，应对原生 API 的强校验
        const isNativeToolCall = assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0;
        const toolCallId = isNativeToolCall ? assistantMessage.tool_calls[0].id : (toolInfo.id || "dummy_id");
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
        const critic_agent = new ReActAgent_1.ReActAgent(temp_llm_service);
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
            if (!callData.params)
                callData.params = {};
            callData.params.llm_params = {
                ...callData.params.llm_params,
                temperature: 0.1,
                tool_choice: "none",
                response_format: { type: "json_object" }
            };
            const messageOutput = await critic_agent.llmCall(callData);
            if (messageOutput && messageOutput.content) {
                const resultStr = messageOutput.content;
                const jsonMatch = resultStr.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const verdict = JSON.parse(jsonMatch[0]);
                    if (verdict.pass === false) {
                        logger_1.logger.log(`[Critic] 拦截成功! 发现伪造数据: ${verdict.reason}`);
                        return `[CRITIC REJECTION] Execution Blocked. Your payload violates data integrity rules:\nReason: ${verdict.reason}`;
                    }
                }
            }
        }
        catch (error) {
            console.error("[Critic] 审查过程发生异常，默认放行:", error);
        }
        return null;
    }
    async step(data) {
        if (this.state === ReActAgent_1.State.IDLE) {
            this.state = ReActAgent_1.State.RUNNING;
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
        let assistantMessage;
        if (messageOutput) {
            assistantMessage = { ...messageOutput, ...{ group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, tool_format: this.llm_service.chatManager.chat.tool_format, show: true, react: true } };
            this.toolInfo = await this.getToolInfo(data, assistantMessage);
        }
        if (!this.toolInfo)
            return; // 容错处理
        // ==========================================
        // 1. 记录与判断重复思考
        // ==========================================
        const currentThinking = this.toolInfo.thinking;
        // 与上一次思考内容对比，而不是第一次
        if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[this.thinking_repetitions.length - 1] === currentThinking) {
            this.thinking_repetitions.push(currentThinking);
            this.repetitions_delay_empty = 0; // 如果重复，重置容错延迟计数
        }
        else {
            this.repetitions_delay_empty += 1;
            // 超过容错次数，清空记录并以当前的思考作为新的起点
            if (this.repetitions_delay_empty >= (globals_1.utils.getConfig("tool_call")?.repetitions_delay_empty || 1)) {
                this.thinking_repetitions = [currentThinking];
                this.repetitions_delay_empty = 0;
            }
        }
        // ==========================================
        // 2. 拦截死循环并打断 (从原有 else 块中剥离)
        // ==========================================
        if (this.thinking_repetitions.length >= (globals_1.utils.getConfig("tool_call")?.max_thinking_repetitions || 5)) {
            this.llm_service.chatManager.pushMessage(assistantMessage);
            let observation = {
                ask: `You have been stuck in a thinking loop ${this.thinking_repetitions.length} times. Try a new approach to break through, or end it directly.`,
                options: ["End Task", "Try New Approach", "Continue"]
            };
            const { ask, options } = observation;
            this.state = ReActAgent_1.State.PAUSE;
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
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.toolInfo.error, chat: this.llm_service.chatManager.chat });
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
            if (this.state === ReActAgent_1.State.PAUSE) {
                const { ask, options } = observation;
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: ask, end: true, chat: this.llm_service.chatManager.chat });
                this.window?.webContents.send("options", { options: options, group_id: this.llm_service.chatManager.chat.group_id, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool });
            }
            else if (this.state === ReActAgent_1.State.FINAL) {
                this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: observation, end: true, chat: this.llm_service.chatManager.chat });
            }
            else {
                this.llm_service.chatManager.pushMessage({ role: "tool", content: observation.result, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: true });
                this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(data) });
            }
        }
        else if (this.toolInfo?.thinking) {
            assistantMessage.react = false;
            this.llm_service.chatManager.pushMessage(assistantMessage);
            this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: null, end: true, chat: this.llm_service.chatManager.chat });
            this.state = ReActAgent_1.State.FINAL;
        }
    }
    async getToolInfo(data, assistantMessage) {
        const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
        const toolInfo = adapter.getToolInfo(assistantMessage);
        if (!toolInfo.thinking && !toolInfo.tool)
            return; // 网络或内容容错处理
        let toolInfoStr = JSON.stringify(toolInfo, null, 2);
        data.output_format = toolInfoStr;
        this.window?.webContents.send('infoData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: this.getInfo(data) });
        this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: `${toolInfo.thinking}\n\n---\n\n`, chat: this.llm_service.chatManager.chat });
        return toolInfo;
    }
    async act(toolInfo) {
        let observation;
        try {
            if (!this.tools || !Object.prototype.hasOwnProperty.call(this.tools, toolInfo.tool)) {
                observation = {
                    result: "Tool does not exist."
                };
            }
            const will_tool = this.tools[toolInfo.tool].func;
            const response = await will_tool(toolInfo?.params);
            let result;
            if (response?.subagent_tool) {
                result = response.content;
            }
            else {
                result = typeof response === 'string' ? response : JSON.stringify(response, null, 2);
            }
            observation = {
                result: result,
                ask: response?.ask,
                options: response?.options,
                subagent_tool: response?.subagent_tool
            };
        }
        catch (error) {
            console.error(error);
            observation = {
                result: `Tool has been executed with error: ${error.message}`
            };
        }
        return observation;
    }
    async callReAct(data) {
        if (this.state === ReActAgent_1.State.PAUSE) {
            data.role = "tool";
            // 工具响应应和助手消息同一id
            let context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step - 1}`;
            this.llm_service.chatManager.pushMessage({ role: "tool", content: data.query, tool_call_id: this.toolInfo?.id, tool_call_name: this.toolInfo?.tool, group_id: this.llm_service.chatManager.chat.group_id, context_id: context_id, show: true, react: true });
            this.window.webContents.send('toolData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: data.query, del: false });
        }
        else {
            this.llm_service.chatManager.chat.step = 1;
            this.llm_service.chatManager.chat.group_id = String((new Date()).getTime());
            this.llm_service.chatManager.chat.context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step}`;
            data.role = "user";
            this.llm_service.chatManager.fixMessages();
            this.llm_service.chatManager.pushMessage({ role: "user", content: data.query, group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, show: true, react: false });
            this.window.webContents.send('userData', { group_id: this.llm_service.chatManager.chat.group_id, context_id: this.llm_service.chatManager.chat.context_id, content: data.query, del: false });
        }
        this.state = ReActAgent_1.State.IDLE;
        let tool_call = globals_1.utils.getConfig("tool_call");
        while (this.state === ReActAgent_1.State.IDLE || this.state === ReActAgent_1.State.RUNNING) {
            // 延时1s，避免过快进入死循环
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.llm_service.stopFlag) {
                this.state = ReActAgent_1.State.FINAL;
                this.window?.webContents.send('streamData', { group_id: this.llm_service.chatManager.chat.group_id, content: "The user interrupted the task.", end: true, chat: this.llm_service.chatManager.chat });
                break;
            }
            if (data?.max_step && this.llm_service.chatManager.chat.step > data.max_step)
                break;
            data = { ...data, ...tool_call, step: this.llm_service.chatManager.chat.step, tools: this.getToolsPrompt(), react: true };
            await this.step(data);
            this.llm_service.chatManager.chat.step++;
            this.llm_service.chatManager.chat.context_id = `${this.llm_service.chatManager.chat.group_id}${this.llm_service.chatManager.chat.step}`;
            const currentChatName = this.llm_service.chatManager.chat.name;
            if (!currentChatName || currentChatName === globals_1.CHAT_CONST.DEFAULT_NAME) {
                await this.setChatName(data).then(() => {
                    if (this.llm_service.chatManager.chat.name && this.llm_service.chatManager.chat.name !== globals_1.CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('auto-rename-chat', this.llm_service.chatManager.chat);
                    }
                });
            }
            if (!this.prompt_args.subagent) {
                this.setHistory();
            }
        }
        if (this.state === ReActAgent_1.State.FINAL) {
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
exports.ToolCall = ToolCall;
//# sourceMappingURL=ToolCall.js.map