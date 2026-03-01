import JSON5 from 'json5';
import { LLMService } from './LLMService';
import { utils, inner, CHAT_CONST } from '../utils/globals';
import { Message, ChatState } from '../types';

export enum State {
    IDLE = 'idle',
    RUNNING = 'running',
    PAUSE = 'pause',
    FINAL = 'final',
    ERROR = 'error',
}

// 模拟 Electron window 对象的默认结构
const createMockWindow = () => ({
    webContents: {
        send: (channel: string, data: any) => {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`%c[time]${timestamp} Channel: ${channel}, Data:`, "color: blue; font-weight: bold", data);
        }
    }
});

const createMockAlertWindow = () => ({
    create: (content: string) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`%c[time]${timestamp} AlertWindow Content:`, "color: green; font-weight: bold", content);
    }
});

export class ReActAgent {
    public state: State;
    public plugins: any;
    public llm_service: LLMService;
    public window: any;
    public alertWindow: any;
    public context_id?: string; // 用于记录当前的 memory id

    constructor(
        plugins: any,
        llm_service: LLMService,
        window: any = createMockWindow(),
        alertWindow: any = createMockAlertWindow()
    ) {
        this.state = State.IDLE;
        this.plugins = plugins;
        this.llm_service = llm_service;
        this.window = window;
        // 将窗口句柄注入到 llm_service（若 LLMService 中声明了 window 属性）
        (this.llm_service as any).window = window;
        this.alertWindow = alertWindow;
    }

    // 安全的模板字符串格式化函数（替代被废弃的 String.prototype.format）
    private formatTemplate(template: string | null | undefined, data: Record<string, any>): string {
        if (!template) return "";
        let formatText = template.replaceAll("{{", "{").replaceAll("}}", "}");
        formatText = formatText.replace(/\{(.*?)\}/g, (match, cmd) => {
            try {
                const key = cmd.trim();
                return data[key] !== undefined ? data[key] : match;
            } catch (e) {
                console.error(e);
                return match;
            }
        });
        return formatText;
    }

    public changeWindow(window: any = createMockWindow()) {
        this.window = window;
        (this.llm_service as any).window = window;
    }

    public setHistory(chat: ChatState | null = null): boolean | undefined {
        if (!chat) {
            chat = this.llm_service.chatManager.chat;
        }

        if (chat.id) {
            if (chat.tokens == null) chat.tokens = 0;
            if (chat.seconds == null) chat.seconds = 0;

            let history_data = utils.getHistoryData();
            let history_exist = history_data.data.filter((h: any) => h.id === chat!.id);
            let id_exist = history_exist.length > 0;

            if (!id_exist) {
                history_data.data.push(chat);
            } else {
                history_data.data = history_data.data.map((h: any) => h.id === chat!.id ? chat : h);
            }

            utils.setHistoryData(history_data);
            const history_path = utils.getHistoryPath(chat.id);
            this.llm_service.chatManager.saveMessages(history_path);
            return id_exist;
        }
    }

    public delHistory(id: string) {
        let history_data = utils.getHistoryData();
        history_data.data = history_data.data.filter((h: any) => h.id !== id);
        utils.setHistoryData(history_data);
    }

    public renameHistory(chat: ChatState) {
        if (this.llm_service.chatManager.chat.id === chat.id) {
            this.llm_service.chatManager.chat.name = chat.name;
        }
        let history_data = utils.getHistoryData();
        history_data.data = history_data.data.map((h: any) => {
            if (h.id === chat.id) h.name = chat.name;
            return h;
        });
        utils.setHistoryData(history_data);
    }

    public async retry(func: (data: any) => Promise<any>, data: any): Promise<any> {
        data.input = data.output_format !== undefined ? data.output_format : data.query;
        data.system_prompt = data.prompt_format !== undefined ? data.prompt_format : data.prompt;

        if (data.input_template) {
            data.input = this.formatTemplate(data.input_template, data);
        }

        let retry_time = utils.getConfig("retry_time") || 3;
        let count = 0;

        while (count < retry_time) {
            // @ts-ignore: 假设 LLMService 有 public stopFlag（需配合修改 LLMService）
            if (this.llm_service.stopFlag) return null;

            try {
                let output = await func(data);
                if (output) return output;

                count++;
                await utils.delay(2);
            } catch (err) {
                console.error("Retry Error:", err);
                count++;
                await utils.delay(2);
            }
        }
        return null;
    }

    public async llmCall(data: any): Promise<Message | null> {
        const configModels = utils.getConfig("models");
        data.api_url = data.api_url || configModels[data.model]?.api_url;
        data.api_key = data.api_key || configModels[data.model]?.api_key;

        data.params = data.params || configModels[data.model]?.versions?.find((v: any) => {
            return typeof v !== "string" && v.version === data.version;
        });

        if (data.params?.llm_params && Object.keys(data.params.llm_params).length > 0) {
            data.llm_params = data.params.llm_params;
        }

        data.prompt_format = data.prompt_template
            ? this.formatTemplate(data.prompt_template, data)
            : data.prompt;

        const func = (reqData: any) => this.llm_service.chatBase(reqData);

        let baseResult = await this.retry(func, data);

        if (!baseResult) return null;

        data.outputs.push(utils.copy(data.output));

        data.output_format = data.output_template
            ? this.formatTemplate(data.output_template, data)
            : data.output;

        data.output_formats.push(utils.copy(data.output_format));
        return baseResult;
    }

    public async sendData(data: any): Promise<boolean> {
        let agent_messages = this.llm_service.chatManager.getMessages(true).filter(m => m.id === data.id);
        utils.sendData(inner.url_base.data.collection, {
            "chat_id": this.llm_service.chatManager.chat.id,
            "message_id": data.id,
            "user_message": data.query,
            "agent_messages": agent_messages,
        });
        return true;
    }

    public getDataDefault(cdata: any = {}): any {
        let data = utils.copy(cdata);
        let defaults = {
            prompt: data?.prompt,
            query: data?.query,
            img_url: data?.img_url,
            file_path: data?.file_path,
            model: utils.copy(data?.model || this.llm_service.chatManager.chat.model),
            version: utils.copy(data?.version || this.llm_service.chatManager.chat.version),
            output_template: null,
            input_template: null,
            prompt_template: null,
            params: null,
            llm_params: utils.getConfig("llm_params"),
            memory_length: utils.getConfig("memory_length"),
            push_message: true,
            end: null,
            event: this.window?.webContents,
            outputs: [],
            output_formats: []
        };
        return { ...defaults, ...data };
    }

    public async contextAutoOpt(data: any) {
        const auto_optimization = this.plugins.getTool(utils.getConfig('default')?.auto_optimization)?.func;
        if (!auto_optimization) return;

        const messages = this.llm_service.chatManager.getMessages(true);
        let ids: { ids: string[], context_ids: string[] } = { ids: [], context_ids: [] };

        for (const message of messages) {
            // @ts-ignore
            if (this.llm_service.stopFlag) {
                this.window?.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true });
                break;
            }

            let history: any, name: 'ids' | 'context_ids' | undefined, content: any;

            if (typeof message.content === 'string') {
                const content_json = utils.extractJson(message.content);
                if (content_json) content = JSON5.parse(content_json);
            }

            if (message.role === 'user' && message.react === false) {
                history = message.content;
                name = 'ids';
            } else if (content && content.thinking) {
                history = content.thinking;
                name = 'context_ids';
            }

            if (history && name) {
                const pred = await auto_optimization({ query: data.query, history });
                if (pred === null) {
                    this.window?.webContents.send('log', 'Error in loading context automatic optimization model!');
                    break;
                }

                const messages_by_id = messages.filter(msg => msg.id === message.id && msg.context_id === message.context_id);

                if (pred === 0) {
                    messages_by_id.forEach(msg => { msg.del = true; });
                    if (name === 'ids') ids.ids.push(message.id!);
                    else ids.context_ids.push(message.context_id!);
                } else {
                    messages_by_id.forEach(msg => { if (msg?.del) delete msg.del; });
                }
            }
        }

        ids.ids = [...new Set(ids.ids)];
        ids.context_ids = [...new Set(ids.context_ids)];
        this.window?.webContents.send('delete-memory', ids);
    }

    public async compression_message({ id }: { id: string }): Promise<string | null> {
        try {
            const will_compress_messages = this.llm_service.chatManager.getMessages().filter(m => m.id === id);
            if (will_compress_messages.length > 0) {
                const temp_llm_service = new LLMService();
                const react_agent = new ReActAgent(this.plugins, temp_llm_service);

                let combined_content = will_compress_messages.map(msg =>
                    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                ).join("\n\n");

                const prompt = `You are an intelligent assistant skilled at compressing and summarizing contextual content into detailed documents. Please ensure the generated documents are comprehensive and clear, accurately reflecting the original content.`;
                const query = `# context\n\`\`\`text\n${combined_content}\n\`\`\`\nPlease compress the above context into a detailed document. \nRequirements: use concise language while retaining all essential information.\nplease generate the compressed document:`;

                const data = react_agent.getDataDefault({
                    prompt, query, params: { ...utils.getConfig("llm_params"), temperature: 0.3 }
                });

                let messageOutput = await react_agent.llmCall(data);
                if (messageOutput) {
                    let content = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + (messageOutput.content as string).trim();

                    const firstMsg = will_compress_messages[0];
                    const preservedUser = will_compress_messages.find(m => m.role === 'user');

                    const compressed_message: Message = {
                        ...firstMsg,
                        content: content,
                        role: "assistant",
                        react: false,
                        context_id: preservedUser?.context_id ?? firstMsg.context_id
                    };

                    let allMessages = this.llm_service.chatManager.getMessages(true);
                    const originalFirstIndex = allMessages.findIndex(m => m.id === id);

                    const newMessages: Message[] = [];
                    let keptUser = false;

                    for (const m of allMessages) {
                        if (m.id !== id) {
                            newMessages.push(m);
                        } else if (!keptUser && m.role === 'user') {
                            newMessages.push(m);
                            keptUser = true;
                        }
                    }

                    if (keptUser) {
                        const insertPos = newMessages.findIndex(m => m.id === id && m.role === 'user');
                        newMessages.splice(insertPos + 1, 0, compressed_message);
                    } else {
                        const insertPos = originalFirstIndex === -1 ? newMessages.length : originalFirstIndex;
                        newMessages.splice(insertPos, 0, compressed_message);
                    }

                    this.llm_service.chatManager.messages = newMessages;
                    console.log(`Compression success for id: ${id}`);
                    return compressed_message.content as string;
                }
            }
        } catch (error) {
            console.log(`Compression failed for id: ${id}, Error: ${error}`);
        }
        return null;
    }

    public async setChatName(_data: any) {
        if (_data?.is_plugin) {
            this.llm_service.chatManager.chat.name = utils.formatDate();
        } else {
            const temp_llm_service = new LLMService();
            const react_agent = new ReActAgent(this.plugins, temp_llm_service);

            const user_content = this.llm_service.chatManager.messages.find(m => m?.role === "user")?.content || "";
            const history_content = this.llm_service.chatManager.messages
                .filter(m => m?.role === "assistant")
                .map(m => utils.parseJsonContent(m.content as string)?.thinking || "")
                .join("===");

            const prompt = `You are an intelligent assistant skilled at generating short chat names based on contextual content. Please ensure the generated names are concise and clear, accurately reflecting the chat content.`;
            const query = `# history\n\`\`\`text\n# user\n${user_content}\n\n# assistant\n${history_content}\n\`\`\`\n\nGenerate a short ${_data?.language || utils.getLanguage()} chat name based on context. \nReturn name only (strictly no JSON/XML/formatting). \nRequirements: max 20 chars, must contain letters, no pure numbers/symbols/spaces.\nplease generate a name:`;

            const data = react_agent.getDataDefault({ prompt, query, params: { ...utils.getConfig("llm_params"), ..._data.params } });
            const messageOutput = await react_agent.llmCall(data);

            if (messageOutput) {
                this.llm_service.chatManager.chat.name = (messageOutput.content as string).split("\n")[0];
            }
        }
    }

    public newChat(): ChatState {
        this.window.webContents.send('clear');
        this.llm_service.chatManager.init();
        this.setHistory(this.llm_service.chatManager.chat);
        return this.llm_service.chatManager.chat;
    }

    public loadChat(id: string): ChatState {
        const history_path = utils.getHistoryPath(id);
        const max_index = this.load_message(history_path);

        const history_data = utils.getHistoryData();
        const history = history_data.data.find((h: any) => h.id == id);
        let chatName = (history && history.name) ? history.name : CHAT_CONST.DEFAULT_NAME;

        this.llm_service.chatManager.chat = this.llm_service.chatManager.getChatInit({ ...history, name: chatName, max_index: max_index });
        return this.llm_service.chatManager.chat;
    }

    public load_message(filePath: string): number {
        let max_index = 0;
        this.window.webContents.send('clear');
        let messages = this.llm_service.chatManager.loadMessages(filePath);

        if (typeof messages === 'boolean') {
            return max_index;
        }

        if (messages.length > 0) {
            const maxIdMsg = messages.reduce((max, current) => {
                return parseInt(current.id || "0") > parseInt(max.id || "0") ? current : max;
            }, messages[0]);

            if (maxIdMsg.id) {
                max_index = parseInt(maxIdMsg.id);
                const reactMsg = messages.find(m => m.react);

                if (reactMsg) {
                    const maxMemoryId = messages.reduce((max, current) => {
                        return parseInt(current.context_id || "0") > parseInt(max.context_id || "0") ? current : max;
                    }, messages[0]);
                    this.context_id = maxMemoryId.context_id || undefined;
                }

                messages.forEach((message, i) => {
                    let { role, content, id, context_id, react, del } = message;

                    if (role === "user") {
                        this.window.webContents.send('user-data', { id, context_id, content, del });
                    }
                    else if (role === "tool") {
                        const parameters = utils.parseJsonContent(content as string);
                        const tool_call_name = message.tool_call_name || "unknown_tool";

                        switch (tool_call_name) {
                            case "display_file":
                                this.window.webContents.send('stream-data', { id, context_id, content: `${content}\n\n`, end: true, del });
                                break;
                            case "add_subtasks":
                            case "complete_subtasks":
                                this.window.webContents.send('stream-data', { id, context_id, content: `\`\`\`json\n${content}\n\`\`\`\n\n`, end: true, del });
                                break;
                        }

                        if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_call_name)) {
                            this.window.webContents.send('stream-data', { id, context_id, content: `${content}\n\n`, end: true, del });
                        }
                        if (["ask_followup_question", "waiting_feedback", "plan_mode_response"].includes(tool_call_name)) {
                            this.window.webContents.send('stream-data', { id, context_id, content: `${parameters.question}\n\n`, end: true, del });
                        }

                        let content_format = (content as string).replaceAll("\\`", "'").replaceAll("`", "'");
                        this.window.webContents.send('info-data', { id, context_id, content: `Step ${i}, id: ${id}, context_id: ${context_id}, Output:\n\n\`\`\`json\n${content_format}\n\`\`\`\n\n`, del });
                    } else { // assistant
                        if (react) {
                            try {
                                let toolInfo;
                                if (message?.tool_format && message.tool_format !== "prompt") {
                                    if (message?.tool_calls) {
                                        let call = message.tool_calls[0];
                                        toolInfo = {
                                            thinking: content,
                                            tool: call?.function?.name,
                                            params: call?.function?.arguments ? JSON5.parse(call.function.arguments) : {}
                                        };
                                    } else {
                                        toolInfo = { thinking: content, tool: null, params: null };
                                    }
                                } else {
                                    toolInfo = utils.parseJsonContent(content as string);
                                }

                                const thinking = `${toolInfo?.thinking || `Tool call: ${toolInfo.tool || "error"}`}\n\n---\n\n`;
                                let toolInfoStr = JSON.stringify(toolInfo, null, 2).replaceAll("\\`", "'").replaceAll("`", "'");

                                this.window.webContents.send('info-data', { id, context_id, content: `Step ${i}, id: ${id}, context_id: ${context_id}, Output:\n\n\`\`\`json\n${toolInfoStr}\n\`\`\`\n\n`, del });
                                this.window.webContents.send('stream-data', { id, context_id, content: thinking, end: true, del });

                                if (toolInfo.tool === "enter_idle_state") {
                                    this.window.webContents.send('stream-data', { id, context_id, content: toolInfo.params.final_answer, end: true, del });
                                }
                            } catch {
                                this.window.webContents.send('stream-data', { id, context_id, content: null, end: true, del });
                            }
                        } else {
                            this.window.webContents.send('stream-data', { id: id, content: content, end: true, del: del });
                        }
                    }
                });
                console.log(`Load success: ${filePath}`);
            } else {
                console.log(`Load failed: ${filePath}`);
            }
            let { id, context_id, del } = messages[messages.length - 1];
            this.window.webContents.send('stream-data', { id, context_id, content: null, end: true, del });
        }
        return max_index;
    }

    public get_info(data: any): string {
        const output_format = utils.copy(data.output_format);
        data.output_format = data.output_format?.replaceAll("\\`", "'").replaceAll("`", "'");

        let infoTemplate = utils.getConfig("info_template");
        let info = this.formatTemplate(infoTemplate, data);

        data.output_format = output_format; // 恢复原数据
        console.log(info);
        return info;
    }
}