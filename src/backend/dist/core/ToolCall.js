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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolCall = void 0;
const os = __importStar(require("os"));
const ReActAgent_1 = require("./ReActAgent");
const globals_1 = require("../utils/globals");
const format_1 = require("../utils/format");
const McpClient_1 = require("./McpClient");
const Prompts_1 = __importStar(require("./Prompts"));
const MemoryManager_1 = __importDefault(require("../data/MemoryManager"));
const base_tools_1 = __importDefault(require("./base_tools"));
const AdapterFactory_1 = require("../factories/AdapterFactory");
const ToolDSL_1 = require("../utils/ToolDSL");
const logger_1 = require("../utils/logger");
const WindowManager_1 = require("../main/windows/WindowManager");
const LLMAssistant_1 = require("./LLMAssistant");
const public_1 = require("../utils/public");
const { all, any, not, always } = ToolDSL_1.ToolDSL;
const { isSubagent, isMode, hasArg } = ToolDSL_1.Primitives;
class ToolCall extends ReActAgent_1.ReActAgent {
    plugins;
    mcp_client;
    agentConfigs;
    windowManager;
    system_prompt;
    mcp_prompt;
    tools;
    baseTools;
    agentTools;
    prompts;
    memory_manager;
    task_prompt;
    env_prompt;
    todolist_prompt;
    current_context_id = 0;
    memory_list = [];
    response_repetitions = [];
    repetitions_delay_empty = 0;
    toolInfos = [];
    currentToolInfo; // 用于记录当前执行的工具，方便 callReAct 等外部调用读取状态
    currentObservation;
    modeMap = { "auto": ReActAgent_1.Mode.AUTO, "plan": ReActAgent_1.Mode.PLAN, "flash": ReActAgent_1.Mode.FLASH, "act": ReActAgent_1.Mode.ACT };
    rememberedChoices = {};
    llmAssistant;
    tool_schemas;
    constructor(plugins, agentTools = {}, llmService, window, utils, agentConfigs = {
        agent_prompt: null,
        mcp_server: true,
        todolist: true,
        env: true,
        skill: true,
        subagent: false,
        agentMode: "transagent",
        agent_name: "TransMAgent",
    }) {
        super(llmService, window, utils);
        this.llmService = llmService;
        this.plugins = plugins;
        this.llmAssistant = new LLMAssistant_1.LLMAssistant(llmService, plugins, utils);
        this.mcp_client = new McpClient_1.MCPClient(this);
        this.agentConfigs = agentConfigs;
        this.initVar();
        this.baseTools = (0, base_tools_1.default)();
        this.agentTools = agentTools;
        this.tools = {};
        this.prompts = new Prompts_1.default(this);
        this.memory_manager = new MemoryManager_1.default(utils);
        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
        this.todolist_prompt = this.prompts.getTodoListPrompt();
    }
    initVar() {
        this.state = ReActAgent_1.State.IDLE;
        this.memory_list = [];
        this.response_repetitions = [];
        this.repetitions_delay_empty = 0;
        this.llmService.environment_details = {
            system_platform: this.utils.getConfig("tool_call")?.system_platform || os.platform(),
            system_arch: this.utils.getConfig("tool_call")?.system_arch || os.arch(),
            language: this.utils.getLanguage(),
            tmpdir: this.utils.getConfig("tool_call")?.tmpdir || os.tmpdir(),
            time: (0, public_1.formatDate)(),
            mode: ReActAgent_1.Mode.ACT,
            mode_constraint: Prompts_1.MODE_CONSTRAINTS[ReActAgent_1.Mode.ACT],
            envs: null,
            todolist: null,
        };
    }
    /**
     * 获取工具配置
     */
    getToolConfig(toolName) {
        if (!this.plugins)
            return null;
        const tool = this.plugins.getTool(toolName);
        return (tool && typeof tool === 'object') ? tool : null;
    }
    loadMessage(filePath, id) {
        super.loadMessage(filePath, id);
        this.changeMode(this.llmService.chatManager.chat.mode, false);
    }
    getToolsPrompt() {
        // --- 工具策略注册表 ---
        // 在这里声明每个工具在什么条件下允许被使用
        const TOOL_POLICY = {
            'update_env': all(hasArg('env'), not(isMode('PLAN'))),
            'mcp_server': all(hasArg('mcp_server'), not(isMode('PLAN'))),
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
        }
        else if (this.agentConfigs.subagent) {
            this.tools = { ...this.agentTools, ...this.baseTools };
        }
        // 2. 组装上下文 (供 DSL 校验使用)
        const context = {
            args: this.agentConfigs || {},
            env: this.llmService.environment_details || {},
            modes: ReActAgent_1.Mode || {},
            isSubagent: !!this.agentConfigs?.subagent,
            currentMode: this.llmService.environment_details?.mode
        };
        const format = this.llmService.chatManager.chat.tool_format;
        // 3. 流水线处理：过滤 -> 提取Schema -> 格式化
        this.tool_schemas = Object.entries(this.tools)
            .filter(([key, tool]) => {
            // 步骤 A: 基础校验 (是否有 getPrompt 方法，是否被显式禁用)
            if (!tool?.getPrompt)
                return false;
            if (tool.enabled === false && !context.isSubagent)
                return false;
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
            }
            else {
                logger_1.logger.error(`Error tool.getPrompt(): ${key}`);
            }
        })
            .filter(Boolean);
        const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(format);
        return adapter.formatTools(this.tool_schemas);
    }
    async saveLongTermMemory(user_content, final_answer) {
        try {
            if (user_content && final_answer) {
                const time = this.llmService.environment_details.time;
                const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
                await this.memory_manager.addLongTermMemory(this.llmService.chatManager.chat.id, content, time);
            }
        }
        catch (e) {
            console.error("Error saving memory", e);
        }
    }
    memoryUpdate(data) {
        this.system_prompt = async () => {
            const important_memory = await this.memory_manager.getImportantMemory();
            const paramsToFormat = {
                mcp_prompt: this.mcp_prompt,
                cli_prompt: this.prompts.getCliPrompt(),
                extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt),
                skill_prompt: this.prompts.getSkillPrompt(),
                important_memory: important_memory,
            };
            const systemPrompt = (0, format_1.formatString)(this.task_prompt(data.tools), paramsToFormat);
            return systemPrompt.replaceAll(/\n{2,}/g, "\n\n").trim();
        };
    }
    environmentUpdate(data) {
        this.llmService.environment_details.time = (0, public_1.formatDate)();
        this.llmService.environment_details.language = data?.language || this.utils.getLanguage();
        const chatState = this.llmService.chatManager.chat;
        const envs = Object.keys(chatState.envs || {}).map(key => `- ${key}: ${chatState.envs[key]}`);
        const todolist = Object.keys(chatState.vars.tasks || {}).map(task_id => {
            const taskObj = chatState.vars.tasks[task_id];
            const subtasks = taskObj.subtasks.map((sub) => `  - subtask id: ${sub.id}, description: ${sub.description}, status: ${sub.status}`);
            return `- ${task_id}: ${taskObj.task}:\n${subtasks.join("\n")}`;
        });
        this.llmService.environment_details.todolist = todolist.join("\n");
        this.llmService.environment_details.envs = envs.length > 0 ? envs.join("\n") : "";
        this.llmService.environment_details.skills = this.prompts.getSkillPrompt();
        if (this.agentConfigs.env && this.utils.getConfig("tool_call")?.env_message) {
            data.env_message = (0, format_1.formatString)(this.env_prompt, this.llmService.environment_details);
        }
        else {
            data.env_message = null;
        }
        if (this.agentConfigs.todolist && this.utils.getConfig("tool_call")?.todolist_message) {
            data.todolist_message = (0, format_1.formatString)(this.todolist_prompt, this.llmService.environment_details);
        }
        else {
            data.todolist_message = null;
        }
    }
    changeMode(mode = null, saveHistory = true) {
        const selectedMode = this.modeMap[mode || ""] || ReActAgent_1.Mode.ACT;
        const shortMode = this.modeMap[mode || ""] ? mode : "act";
        this.llmService.environment_details.mode = selectedMode;
        this.llmService.environment_details.mode_constraint = Prompts_1.MODE_CONSTRAINTS[selectedMode];
        this.llmService.chatManager.chat.mode = shortMode;
        if (!this.agentConfigs.subagent && saveHistory) {
            this.setHistory();
        }
    }
    /**
     * 获取已记住的工具选择
     */
    getRememberedChoice(toolName) {
        if (this.rememberedChoices.hasOwnProperty(toolName)) {
            return this.rememberedChoices[toolName];
        }
        return null;
    }
    /**
     * 记住工具选择
     */
    setRememberedChoice(toolName, confirmed) {
        this.rememberedChoices[toolName] = confirmed;
    }
    async step(data) {
        if (this.state === ReActAgent_1.State.IDLE) {
            this.state = ReActAgent_1.State.RUNNING;
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
        }
        else {
            return;
        }
        if (!this.toolInfos || this.toolInfos.length === 0) {
            logger_1.logger.error(`Tool Info Error`);
            this.window?.webContents.send('infoData', {
                ...this.llmService.chatManager.chat,
                content: `Tool Info Error\n`,
                uuid: data.uuid
            });
            return;
        }
        ; // 容错处理
        // 1. 记录与重复检测
        const currentResponse = JSON.stringify(this.toolInfos);
        if (this.response_repetitions.length === 0 || this.response_repetitions[this.response_repetitions.length - 1] === currentResponse) {
            this.response_repetitions.push(currentResponse);
            this.repetitions_delay_empty = 0;
        }
        else {
            this.repetitions_delay_empty += 1;
            if (this.repetitions_delay_empty >= (this.utils.getConfig("tool_call")?.repetitions_delay_empty || 1)) {
                this.response_repetitions = [currentResponse];
                this.repetitions_delay_empty = 0;
            }
        }
        if (this.response_repetitions.length > (this.utils.getConfig("tool_call")?.max_response_repetitions || 5)) {
            const error_message = `Detected repetitive response: "${currentResponse}". Repetition count: ${this.response_repetitions.length}`;
            logger_1.logger.warn(error_message);
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
            this.state = ReActAgent_1.State.ERROR;
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
            this.state = ReActAgent_1.State.FINAL;
            return;
        }
        // 3. 循环并发遍历所有工具 (依次执行，确保上下文有序)
        for (const toolInfo of this.toolInfos) {
            if (!toolInfo.tool_call_name)
                continue;
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
                    ...toolInfo, ...this.llmService.chatManager.chat, content: `User intercept:\n ${auditError}`, uuid: data.uuid
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
            if (requireConfirmation && WindowManager_1.WindowManager.instance?.confirmationWindow && this.llmService.environment_details.mode === ReActAgent_1.Mode.ACT) {
                let toolDescription = '';
                const toolName = toolInfo.tool_call_name;
                // 检查是否有已记住的选择
                const rememberedChoice = this.getRememberedChoice(toolName);
                if (rememberedChoice !== null) {
                    if (rememberedChoice) {
                        let observation = await this.act(toolInfo);
                        this.handleToolObservation(observation, toolInfo, data);
                    }
                    else {
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
                    if (this.state === ReActAgent_1.State.PAUSE)
                        break;
                    continue; // 跳过确认窗口，处理下一个工具
                }
                // 尝试从工具定义中获取描述
                if (this.tools[toolName] && this.tools[toolName].getPrompt) {
                    try {
                        const promptInfo = this.tools[toolName].getPrompt();
                        if (promptInfo && promptInfo.description) {
                            toolDescription = promptInfo.description;
                        }
                    }
                    catch (error) {
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
                    const response = await WindowManager_1.WindowManager.instance.confirmationWindow.showConfirmation(confirmationRequest);
                    if (response.rememberChoice) {
                        this.setRememberedChoice(toolName, response.confirmed);
                    }
                    if (response.confirmed) {
                        let observation = await this.act(toolInfo);
                        this.handleToolObservation(observation, toolInfo, data);
                    }
                    else {
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
                }
                catch (error) {
                    console.error("确认窗口错误:", error);
                    // 如果确认窗口本身出错（IPC 崩溃等），默认放行执行
                    let observation = await this.act(toolInfo);
                    this.handleToolObservation(observation, toolInfo, data);
                }
                // 状态机流转：如果弹窗后执行的工具（或回调）让状态变成了暂停，直接跳出并发循环
                if (this.state === ReActAgent_1.State.PAUSE)
                    break;
                continue; // 处理完毕当前高风险工具，进行下一个
            }
            // [4. 标准工具安全执行]
            let observation = await this.act(toolInfo);
            this.handleToolObservation(observation, toolInfo, data);
            // [关键防御点]：如果当前工具（例如 ask_user）需要挂起等待用户回复，必须立刻阻断后续工具的并发执行
            if (this.state === ReActAgent_1.State.PAUSE) {
                break;
            }
        }
        if (this.llmService.chatManager.chat.tokens >= this.llmService.chatManager.chat.max_tokens) {
            this.llmAssistant.kvCacheSummary();
            this.llmService.chatManager.chat.long_memory_length = Math.floor(this.llmService.chatManager.chat.long_memory_length / 2);
            this.llmService.chatManager.chat.memory_length = Math.floor(this.llmService.chatManager.chat.memory_length / 2);
        }
    }
    async getToolInfos(data, assistantMessage) {
        const adapter = AdapterFactory_1.ToolCallAdapterFactory.getAdapter(this.llmService.chatManager.chat.tool_format);
        const toolInfos = adapter.getToolInfos(assistantMessage);
        // 网络或内容容错处理
        if (toolInfos.length === 1 && !toolInfos[0].content && !toolInfos[0].reasoning_content && !toolInfos[0].tool_call_name)
            return [];
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
    async act(toolInfo) {
        let observation;
        try {
            if (!this.tool_schemas || !this.tool_schemas.map(tool => tool.name).includes(toolInfo.tool_call_name)) {
                observation = {
                    result: "Tool does not exist."
                };
            }
            else {
                const will_tool = this.tools[toolInfo.tool_call_name].func;
                const response = await will_tool({ ...toolInfo?.params, toolCall: this });
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
        }
        catch (error) {
            console.error(error);
            observation = {
                result: `Tool has been executed with error: ${error.message}`
            };
        }
        this.currentObservation = observation; // 更新当前状态引用，供 callReAct 等外部断点恢复使用
        return observation;
    }
    handleToolObservation(observation, toolInfo, data) {
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
        if (this.state === ReActAgent_1.State.PAUSE) {
            const { ask, options } = observation;
            this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n${ask}`, uuid: data.uuid, end: true });
            this.window?.webContents.send('handleOptions', { ...this.llmService.chatManager.chat, ...toolInfo, options: options, uuid: data.uuid });
        }
        else if (this.state === ReActAgent_1.State.FINAL) {
            this.llmService.chatManager.pushToolMessage({ ...this.llmService.chatManager.chat, ...toolInfo, content: observation.result, uuid: data.uuid });
            this.window?.webContents.send('streamData', { ...this.llmService.chatManager.chat, content: `\n\n${observation.result}`, uuid: data.uuid, end: true });
        }
        else {
            this.llmService.chatManager.pushToolMessage({ ...this.llmService.chatManager.chat, ...toolInfo, content: observation.result, uuid: data.uuid });
            this.window?.webContents.send('infoData', { ...this.llmService.chatManager.chat, content: this.getInfo({ output_format: observation.result }), uuid: data.uuid });
        }
    }
    async callReAct(data) {
        this.setUUID(data);
        if (this.state === ReActAgent_1.State.PAUSE) {
            data.role = "tool";
            let context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step - 1}`;
            this.llmService.chatManager.pushToolMessage({
                ...this.currentToolInfo,
                ...this.llmService.chatManager.chat,
                context_id: context_id,
                content: data.query,
                uuid: data.uuid
            });
            this.window?.webContents.send('toolData', { ...this.llmService.chatManager.chat, content: `\n\n---\n\n${data.query}`, uuid: data.uuid });
        }
        else {
            this.llmService.chatManager.chat.step = 1;
            this.llmService.chatManager.chat.group_id = String((new Date()).getTime());
            this.llmService.chatManager.chat.context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step}`;
            data.role = "user";
            this.llmService.chatManager.fixMessages();
            this.llmService.chatManager.pushUserMessage({ ...this.llmService.chatManager.chat, content: data.query, uuid: data.uuid });
            this.window?.webContents.send('userData', { ...this.llmService.chatManager.chat, content: data.query, uuid: data.uuid });
        }
        this.window?.webContents.send('agentRunning', { group_id: this.llmService.chatManager.chat.group_id, uuid: data.uuid });
        this.state = ReActAgent_1.State.IDLE;
        let tool_call = this.utils.getConfig("tool_call");
        this.llmService.chatManager.chat.seconds = 0;
        while (this.state === ReActAgent_1.State.IDLE || this.state === ReActAgent_1.State.RUNNING) {
            // 延时1s，避免过快进入死循环
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.llmService.stopFlag) {
                this.state = ReActAgent_1.State.FINAL;
                this.window?.webContents.send('streamData', { group_id: this.llmService.chatManager.chat.group_id, end: true, uuid: data.uuid });
                break;
            }
            if (data?.max_step && this.llmService.chatManager.chat.step > data.max_step)
                break;
            data = { ...data, ...tool_call, step: this.llmService.chatManager.chat.step, tools: this.getToolsPrompt(), react: true };
            // 记录开始时间
            const startSeconds = Date.now() / 1000;
            await this.step(data);
            // 记录结束时间
            const endSeconds = Date.now() / 1000;
            this.llmService.chatManager.chat.seconds += (endSeconds - startSeconds);
            this.llmService.chatManager.chat.step++;
            this.llmService.chatManager.chat.context_id = `${this.llmService.chatManager.chat.group_id}${this.llmService.chatManager.chat.step}`;
            const currentChatName = this.llmService.chatManager.chat.name;
            if (!currentChatName || currentChatName === globals_1.CHAT_CONST.DEFAULT_NAME) {
                await this.setChatName(data).then(() => {
                    if (this.llmService.chatManager.chat.name && this.llmService.chatManager.chat.name !== globals_1.CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('handleRenameChat', { ...this.llmService.chatManager.chat, uuid: data.uuid });
                    }
                });
            }
            if (!this.agentConfigs.subagent) {
                this.setHistory();
            }
        }
        if (this.state === ReActAgent_1.State.FINAL || this.state === ReActAgent_1.State.ERROR) {
            if (!this.agentConfigs.subagent) {
                this.setHistory();
                // 整理记忆文件
                this.llmAssistant.organizeMemory().catch(err => {
                    logger_1.logger.warn(`[ToolCall] Memory organization failed: ${err}`);
                });
            }
        }
        if (!this.agentConfigs.subagent) {
            this.sendData(data);
        }
        return data;
    }
}
exports.ToolCall = ToolCall;
//# sourceMappingURL=ToolCall.js.map