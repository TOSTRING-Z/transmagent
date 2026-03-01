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
    public mcp_client: any;
    public prompt_args: PromptArgs;
    public modes: Record<string, string>;
    public system_prompt!: () => Promise<string> | string;
    public mcp_prompt!: string;
    public base_tools: any;
    public tools: Record<string, any>;
    public prompts: Prompts;
    public memory_manager: MemoryManager;
    public task_prompt: () => string;
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

        this.task_prompt = () => this.prompts.getSystemPrompts();
        this.env_prompt = this.prompts.getEnvPrompts();
    }

    public init_var() {
        this.current_context_id = 0;
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

    public get_tools_prompt(): any[] {
        const format = this.llm_service.chatManager.chat.tool_format;
        const tool_schemas: any[] = [];

        for (let key in this.tools) {
            if (this.tools[key]?.getPrompt) {
                const schemaOrStr = this.tools[key].getPrompt();
                if (typeof schemaOrStr === 'string') {
                    tool_schemas.push({ type: "raw_string", content: schemaOrStr });
                } else {
                    tool_schemas.push(schemaOrStr);
                }
            }
        }

        if (format === "openai") {
            return tool_schemas.map(schema => {
                if (schema.type === "raw_string" || schema.name === "enter_idle_state") return null;
                return { type: "function", function: schema };
            }).filter(Boolean);
        } else {
            const tool_prompt: string[] = [];
            for (const schema of tool_schemas) {
                if (schema.type === "raw_string") {
                    tool_prompt.push(schema.content);
                } else {
                    let paramsStr = '';
                    const exampleParams: Record<string, string> = {};

                    if (schema.parameters && schema.parameters.properties) {
                        for (const [key, prop] of Object.entries<any>(schema.parameters.properties)) {
                            const required = schema.parameters.required?.includes(key) ? "(Required)" : "(Optional)";
                            paramsStr += `- ${key}: ${required} ${prop.description || ''}\n`;
                            if (schema.parameters.required?.includes(key)) {
                                exampleParams[key] = `[${prop.type} value]`;
                            }
                        }
                    }

                    const usageObj = { thinking: "[Thinking process]", tool: schema.name, params: exampleParams };
                    const usageStr = JSON.stringify(usageObj, null, 2).replace(/\n/g, '\\n');

                    tool_prompt.push(`## ${schema.name}\nDescription: ${schema.description}\n\nParameters:\n${paramsStr}\nUsage:\n${usageStr}`);
                }
            }
            return tool_prompt;
        }
    }

    public async save_long_term_memory(user_content: string, final_answer: string) {
        try {
            if (user_content && final_answer) {
                const time = this.environment_details.time;
                const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
                await this.memory_manager.addLongTermMemory(this.llm_service.chatManager.chat.id, content, time);
            }
        } catch (e) {
            console.error("Error saving memory", e);
        }
    }

    public memory_update(data: any) {
        let messages = this.llm_service.chatManager.getMessages(false);
        let messages_list: Message[] = [];

        if (messages.length > data.memory_length) {
            const startIdx = Math.max(messages.length - data.long_memory_length - data.memory_length, 0);
            messages_list = messages.slice(startIdx, messages.length - data.memory_length).map(message => {
                const message_copy = this.llm_service.chatManager.delMessage(message, message?.del);
                delete message_copy.react;
                delete message_copy.id;
                delete message_copy.show;
                return message_copy;
            });
        }

        this.memory_list = messages_list;

        this.system_prompt = async () => {
            const format = this.llm_service.chatManager.chat.tool_format;
            const toolsData = this.get_tools_prompt();
            const important_memory = await this.memory_manager.getImportantMemory();
            const paramsToFormat = {
                system_type: utils.getConfig("tool_call")?.system_type || os.type(),
                system_platform: utils.getConfig("tool_call")?.system_platform || os.platform(),
                system_arch: utils.getConfig("tool_call")?.system_arch || os.arch(),
                tool_prompt: format === "prompt" ? toolsData.join("\n\n") : "",
                mcp_prompt: this.mcp_prompt,
                cli_prompt: this.prompts.getCliPrompt(),
                extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt),
                important_memory: important_memory,
                memory_list: JSON.stringify(this.memory_list, null, 2)
            }
            return formatString(this.task_prompt(), paramsToFormat);
        }
    }

    public environment_update(data: any) {
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

    public async step(data: any) {
        if (!this.mcp_prompt && this.prompt_args.mcp_server) {
            await this.mcp_client.initMcp();
            this.mcp_prompt = this.mcp_client.mcp_prompt;
        }

        data.push_message = false;

        if (this.state === State.IDLE) {
            this.llm_service.chatManager.pushMessage({ role: "user", content: data.query, id: data.id, context_id: String(this.current_context_id++), show: true, react: false });
            this.state = State.RUNNING;
        }

        this.environment_update(data);
        this.memory_update(data);

        const toolInfo = await this.task(data);

        if (toolInfo?.tool) {
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
            this.llm_service.chatManager.pushMessage({ role: "tool", content: data.output_format, tool_call_id: toolInfo?.id, tool_call_name: toolInfo?.tool, id: data.id, context_id: String(this.current_context_id), show: true, react: true });

            if (warning_info?.warning) {
                this.state = State.PAUSE;
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: `${warning_info.warning}\n\n`, end: true, chat: this.llm_service.chatManager.chat });
                return warning_info.options;
            }

            switch (toolInfo.tool) {
                case "display_file":
                    this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: `${observation}\n\n`, chat: this.llm_service.chatManager.chat });
                    break;
                case "add_subtasks":
                case "record_subtasks":
                    this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: `\`\`\`json\n${JSON.stringify(observation, null, 2)}\n\`\`\`\n\n`, chat: this.llm_service.chatManager.chat });
                    break;
            }

            if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(toolInfo.tool)) {
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: observation, end: false, chat: this.llm_service.chatManager.chat });
            }

            if (this.state === State.PAUSE) {
                const { question, options } = observation.content;
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: question || "", end: true, chat: this.llm_service.chatManager.chat });
                return options;
            }

            if (this.state === State.FINAL) {
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: observation, end: true, chat: this.llm_service.chatManager.chat });
            } else {
                this.window?.webContents.send('info-data', { id: data.id, context_id: String(this.current_context_id), content: this.get_info(data) });
            }
        } else if (toolInfo?.thinking) {
            this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: null, end: true, chat: this.llm_service.chatManager.chat });
            this.state = State.FINAL;
        }
    }

    public async task(data: any) {
        data.prompt = await this.system_prompt();
        const messageOutput = await this.llmCall(data);
        if (messageOutput) {
            const message = { ...messageOutput, ...{ id: data.id, context_id: String(this.current_context_id), tool_format: this.llm_service.chatManager.chat.tool_format, show: true, react: true } }
            this.llm_service.chatManager.pushMessage(message);
            const adapter: IToolCallAdapter = ToolCallAdapterFactory.getAdapter(this.llm_service.chatManager.chat.tool_format);
            const toolInfo = adapter.getToolInfo(message);
            if (toolInfo?.error) {
                data.output_format = toolInfo.error;
                this.llm_service.chatManager.setTag(false);
                this.llm_service.chatManager.pushMessage({ role: "user", content: data.output_format, id: data.id, context_id: String(this.current_context_id), show: true, react: true });
                this.environment_update(data);
                this.window?.webContents.send('info-data', { id: data.id, context_id: String(this.current_context_id), content: this.get_info(data) });
            } else {
                let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("\\`", "'").replaceAll("`", "'");
                data.output_format = toolInfoStr;
                this.window?.webContents.send('info-data', { id: data.id, context_id: String(++this.current_context_id), content: this.get_info(data) });
            }
            // 统计重复思考以打断死循环
            if (toolInfo?.thinking) {
                if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[0] === toolInfo.thinking) {
                    this.thinking_repetitions.push(toolInfo.thinking);
                } else {
                    this.repetitions_delay_empty += 1;
                    if (this.repetitions_delay_empty >= (utils.getConfig("tool_call")?.repetitions_delay_empty || 2)) {
                        this.thinking_repetitions.length = 0;
                        this.repetitions_delay_empty = 0;
                    }
                }
                this.window?.webContents.send('stream-data', { id: data.id, context_id: String(this.current_context_id), content: `${toolInfo.thinking}\n\n---\n\n`, chat: this.llm_service.chatManager.chat });
            }
            return toolInfo;
        }
    }


    public async act(toolInfo: ToolInfo): Promise<any> {
        let observation: any;
        try {
            if (!this.tools || !Object.prototype.hasOwnProperty.call(this.tools, toolInfo.tool as string)) {
                this.llm_service.chatManager.setTag(false);
                observation = "Tool does not exist.";
            }
            const will_tool = this.tools[toolInfo.tool as string].func;
            observation = await will_tool(toolInfo?.params);
            if (toolInfo?.tool === "cli_execute") {
                this.llm_service.chatManager.setTag(observation?.success);
            } else {
                this.llm_service.chatManager.setTag(true);
            }
        } catch (error: any) {
            console.error(error);
            this.llm_service.chatManager.setTag(false);
            observation = `Tool has been executed with error: ${error.message}`;
        }
        return observation;
    }

    public async callReAct(data: any): Promise<any> {
        let step = 0;
        this.state = State.IDLE;
        let tool_call = utils.getConfig("tool_call");

        if (this.llm_service.chatManager.chat.tool_format !== "prompt") {
            data.tools = this.get_tools_prompt();
        }
        // @ts-ignore
        while (this.state !== State.FINAL && this.state !== State.PAUSE) {
            // @ts-ignore
            // 延时1s，避免过快进入死循环
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.llm_service.stopFlag) {
                this.state = State.FINAL;
                this.window?.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true, chat: this.llm_service.chatManager.chat });
                break;
            }
            if (data?.max_step && step > data.max_step) break;

            data = { ...data, ...tool_call, step: ++step, context_id: String(this.current_context_id), react: true };

            let options = await this.step(data);

            const currentChatName = this.llm_service.chatManager.chat.name;
            if (!currentChatName || currentChatName === CHAT_CONST.DEFAULT_NAME) {
                this.setChatName(data).then(() => {
                    if (this.llm_service.chatManager.chat.name && this.llm_service.chatManager.chat.name !== CHAT_CONST.DEFAULT_NAME) {
                        this.window?.webContents.send('auto-rename-chat', this.llm_service.chatManager.chat);
                    }
                });
            }

            if (!this.prompt_args.subagent) {
                this.setHistory();
            }
            // @ts-ignore
            if (this.state === State.PAUSE) {
                this.window?.webContents.send("options", { options, id: data.id });
            }
        }

        if (!this.prompt_args.subagent) {
            this.sendData(data);
        }
        return data;
    }
}