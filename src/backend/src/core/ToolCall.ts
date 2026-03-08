import * as os from 'os';
import { ReActAgent, State } from './ReActAgent';
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
    mode: string;
    envs: string | null;
    todolist: string | null;
    skills?: string;
}

export class ToolCall extends ReActAgent {
    public mcp_client: MCPClient;
    public prompt_args: PromptArgs;
    public modes: Record<string, string>;
    public system_prompt!: () => Promise<string> | string;
    public mcp_prompt!: string;
    public base_tools: any;
    public tools: Record<string, any>;
    public prompts: Prompts;
    public memory_manager: MemoryManager;
    public task_prompt: (toolsData) => string;
    public env_prompt: string;
    public current_context_id: number = 0;
    public memory_list: Message[] = [];
    public thinking_repetitions: string[] = [];
    public repetitions_delay_empty: number = 0;
    public environment_details!: EnvironmentDetails;

    constructor(
        plugins: any,
        tools: Record<string, any> = {},
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
        super(plugins, llm_service, window, alertWindow);
        this.mcp_client = new MCPClient(this);
        this.prompt_args = prompt_args;

        this.modes = {
            AUTO: 'Automatic mode',
            ACT: 'Execution mode',
            PLAN: 'Planning mode',
            FLASH: 'Flash mode',
        };

        this.init_var();

        this.base_tools = getBaseTools(this);
        this.tools = { ...tools, ...this.base_tools };

        this.prompts = new Prompts(this);
        this.memory_manager = new MemoryManager(utils);

        this.task_prompt = (toolsData) => this.prompts.getSystemPrompts(toolsData);
        this.env_prompt = this.prompts.getEnvPrompts();
    }

    public init_var() {
        this.llm_service.chatManager.chat.max_context_id = 0;
        this.memory_list = [];
        this.thinking_repetitions = [];
        this.repetitions_delay_empty = 0;

        this.environment_details = {
            language: utils.getLanguage(),
            tmpdir: utils.getConfig("tool_call")?.tmpdir || os.tmpdir(),
            time: utils.formatDate(),
            mode: this.modes.ACT,
            envs: null,
            todolist: null,
        };
    }

    public get_tools_prompt(): any {
        if (this.plugins) {
            this.plugins.init(null, true);
            this.tools = { ...this.plugins.getTool(), ...this.base_tools };
        }
        const format = this.llm_service.chatManager.chat.tool_format;
        const tool_schemas: any[] = [];
        const args = this.prompt_args || {};
        const env = this.environment_details || {};
        const modes = this.modes || {};
        const isSubagent = !!args.subagent;
        const currentMode = env.mode;

        // 1. 收集并过滤工具
        for (let key in this.tools) {
            if (key === 'mcp_server') {
                if (!args.mcp_server) continue;
            }
            if (key === 'add_subtasks' || key === 'record_subtasks') {
                if (!(args.todolist && currentMode !== modes.FLASH)) continue;
            }
            if (key === 'ask_followup_question') {
                if (isSubagent || currentMode !== modes.ACT) continue;
            }
            if (key === 'waiting_feedback') {
                if (isSubagent || currentMode === modes.FLASH || currentMode === modes.AUTO) continue;
            }
            if (key === 'plan_mode_response') {
                if (currentMode !== modes.PLAN) continue;
            }
            if (key === 'context_retrieval' || key === 'search_long_term_memory' || key === 'write_important_memory') {
                if (isSubagent) continue;
            }

            if (this.tools[key]?.getPrompt) {
                const schemaOrStr = this.tools[key].getPrompt();
                if (typeof schemaOrStr === 'string') {
                    tool_schemas.push({ type: "raw_string", name: key, content: schemaOrStr });
                } else {
                    tool_schemas.push(schemaOrStr);
                }
            }
        }

        // 2. 获取对应的适配器
        const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(format);

        // 3. 执行格式化
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
            const toolsData = this.get_tools_prompt();
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
            const systemPrompt = formatString(this.task_prompt(toolsData), paramsToFormat);
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
        const modeMap: Record<string, string> = { "auto": this.modes.AUTO, "plan": this.modes.PLAN, "flash": this.modes.FLASH, "act": this.modes.ACT };
        const selectedMode = modeMap[mode || ""] || this.modes.ACT;
        const shortMode = modeMap[mode || ""] ? mode : "act";

        this.environment_details.mode = selectedMode;
        this.llm_service.chatManager.chat.mode = shortMode as string;
        this.window?.webContents.send('change-mode', shortMode);
    }

    public async step(data: Record<string, any>) {
        if (!this.mcp_prompt && this.prompt_args.mcp_server) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcpPrompt;
        }

        data.push_message = false;

        if (this.state === State.IDLE) {
            this.llm_service.chatManager.pushMessage({ role: "user", content: data.query, id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), show: true, react: false });
            this.state = State.RUNNING;
        }

        this.environment_update(data);
        this.memory_update(data);

        const toolInfo = await this.task(data);

        if (toolInfo?.error) {
            this.llm_service.chatManager.pushMessage({ role: "tool", content: toolInfo.error, tool_call_id: toolInfo?.id, tool_call_name: toolInfo?.tool, id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), show: true, react: true });
            this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: toolInfo.error, chat: this.llm_service.chatManager.chat });
        }
        else if (toolInfo?.tool) {
            let observation = await this.act(toolInfo);
            let warning_info: { warning: string; options: string[] } | null = null;
            if (this.thinking_repetitions.length >= (utils.getConfig("tool_call")?.max_thinking_repetitions || 3)) {
                warning_info = {
                    warning: `You have been stuck in a thinking loop ${this.thinking_repetitions.length} times. Try a new approach to break through, or end it directly.`,
                    options: ["End Task", "Try New Approach"]
                };
                this.thinking_repetitions.length = 0;
            }

            data.output_format = typeof observation === "string" ? observation : JSON.stringify(observation, null, 2);
            this.llm_service.chatManager.pushMessage({ role: "tool", content: data.output_format, tool_call_id: toolInfo?.id, tool_call_name: toolInfo?.tool, id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), show: true, react: true });

            if (warning_info?.warning) {
                this.state = State.PAUSE;
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: `${warning_info.warning}\n\n`, end: true, chat: this.llm_service.chatManager.chat });
                return warning_info.options;
            }

            switch (toolInfo.tool) {
                case "display_file":
                    this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: `${observation}\n\n`, chat: this.llm_service.chatManager.chat });
                    break;
                case "add_subtasks":
                case "record_subtasks":
                    this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: `\`\`\`json\n${JSON.stringify(observation, null, 2)}\n\`\`\`\n\n`, chat: this.llm_service.chatManager.chat });
                    break;
            }

            if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(toolInfo.tool)) {
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: observation, end: false, chat: this.llm_service.chatManager.chat });
            }

            if ((this.state as any) === "pause") {
                const { question, options } = observation;
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: question || "", end: true, chat: this.llm_service.chatManager.chat });
                return options;
            }

            if ((this.state as any) === "final") {
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: observation, end: true, chat: this.llm_service.chatManager.chat });
            } else {
                this.window?.webContents.send('info-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: this.get_info(data) });
            }
        } else if (toolInfo?.thinking) {
            this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: null, end: true, chat: this.llm_service.chatManager.chat });
            this.state = State.FINAL;
        }
    }

    public async task(data: Record<string, any>) {
        data.prompt = await this.system_prompt();
        const messageOutput = await this.llmCall(data);
        if (messageOutput) {
            const message = { ...messageOutput, ...{ id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), tool_format: this.llm_service.chatManager.chat.tool_format, show: true, react: true } }
            this.llm_service.chatManager.pushMessage(message);
            const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
            const toolInfo = adapter.getToolInfo(message);
            let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("\\`", "'").replaceAll("`", "'");
            data.output_format = toolInfoStr;
            this.window?.webContents.send('info-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: this.get_info(data) });
            // 统计重复思考以打断死循环
            if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[0] === toolInfo.thinking) {
                this.thinking_repetitions.push(toolInfo.thinking);
            } else {
                this.repetitions_delay_empty += 1;
                if (this.repetitions_delay_empty >= (utils.getConfig("tool_call")?.repetitions_delay_empty || 2)) {
                    this.thinking_repetitions.length = 0;
                    this.repetitions_delay_empty = 0;
                }
            }
            this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.llm_service.chatManager.chat.max_context_id), content: `${toolInfo.thinking}\n\n---\n\n`, chat: this.llm_service.chatManager.chat });

            return toolInfo;
        }
    }

    public async act(toolInfo: ToolInfo): Promise<any> {
        let observation: any;
        try {
            if (!this.tools || !Object.prototype.hasOwnProperty.call(this.tools, toolInfo.tool as string)) {
                observation = "Tool does not exist.";
            }
            const will_tool = this.tools[toolInfo.tool as string].func;
            observation = await will_tool(toolInfo?.params);
        } catch (error: any) {
            console.error(error);
            observation = `Tool has been executed with error: ${error.message}`;
        }
        return observation;
    }

    public async callReAct(data: Record<string, any>): Promise<any> {
        let step = 0;
        this.state = State.IDLE;
        let tool_call = utils.getConfig("tool_call");

        if (this.llm_service.chatManager.chat.tool_format !== "prompt") {
            data.tools = this.get_tools_prompt();
        }
        this.llm_service.chatManager.fixMessages();
        while (this.state !== (State.FINAL as State) && this.state !== (State.PAUSE as State)) {
            // @ts-ignore
            // 延时1s，避免过快进入死循环
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.llm_service.stopFlag) {
                this.state = State.FINAL;
                this.window?.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true, chat: this.llm_service.chatManager.chat });
                break;
            }
            if (data?.max_step && step > data.max_step) break;

            data = { ...data, ...tool_call, step: ++step, context_id: String(this.llm_service.chatManager.chat.max_context_id), react: true };

            let options = await this.step(data);

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
            if ((this.state as any) === "pause") {
                this.window?.webContents.send("options", { options, id: data.id });
            }
        }

        if (this.state === State.FINAL && this.llm_service.chatManager.chat.compress_context && (this as any).final_answer) {
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