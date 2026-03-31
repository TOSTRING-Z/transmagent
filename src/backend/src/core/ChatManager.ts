import * as fs from 'fs';
import { logger } from '../utils/logger';

import * as path from 'path';
import JSON5 from 'json5';
import { Message, ChatState } from '../types';
import { utils, CHAT_CONST } from '../utils/globals';

export class ChatManager {
    public messages: Message[] = [];
    public chat: ChatState;
    public tagSuccess: boolean = false;

    constructor(messages: Message[] = [], chatInitParams: Partial<ChatState> = {}) {
        this.chat = this.getChatInit(chatInitParams);
        this.init(messages);
    }

    public init(messages: Message[] = []) {
        this.chat = this.getChatInit();
        this.messages = messages;
        this.tagSuccess = false;
        this.updateChat();
    }

    public updateChat() {
        this.chat.msg_count = this.getMessages(false).length;
    }

    public getMessages(all = true): Message[] {
        if (all) return utils.copy(this.messages);
        let msgs = utils.copy(this.messages.filter(message => !message?.del));
        return msgs;
    }

    public compressContext(messages): Message[] {
        let msgs = utils.copy(messages);
        const lastMessage = msgs[msgs.length - 1];
        if (this.chat.compress_context) {
            msgs = msgs.filter(message => {
                // 最后一条消息若是react
                if (lastMessage.react) {
                    if (lastMessage.group_id === message.group_id) {
                        return true;
                    }
                }
                return !message.react;
            }).map(message => {
                if (message.role === "assistant" && !message.react) {
                    message.content = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + (message.content as string).trim();
                }
                return message;
            });
        }
        return msgs;
    }

    public pushMessage(msg: Message) {
        this.messages.push(msg);
        this.updateChat();
    }

    public popMessage(group_id?: string, context_id?: string): Message | null {
        if (this.messages.length > 0) {
            if (!group_id && !context_id) {
                const popped = this.messages.pop();
                this.updateChat();
                return popped || null;
            } else {
                this.messages = this.messages.filter(message => {
                    return !(message.group_id === group_id || message.context_id === context_id);
                });
                this.updateChat();
                return null;
            }
        }
        return null;
    }

    public getChatId(): string {
        return `chat-${crypto.randomUUID()}`;
    }

    public getDefaultConfig() {
        const defaultConfig = utils.getConfig("default") || {};
        return {
            model: defaultConfig["model"] || "deepseek",
            version: defaultConfig["version"] || "deepseek-chat",
            tool_format: defaultConfig["tool_format"] || "prompt",
            is_plugin: defaultConfig["model"] === "plugins",
            compress_context: defaultConfig["compress_context"] || false,
        };
    }

    public getChatInit(params: Partial<ChatState> = {}): ChatState {
        const defaultConfig = this.getDefaultConfig();
        return {
            id: this.getChatId(),
            name: CHAT_CONST.DEFAULT_NAME,
            system_prompt: null,
            context_id: 0,
            mode: "act",
            tokens: 0,
            seconds: 0,
            msg_count: 0,
            envs: {},
            vars: {
                task_id: 0,
                tasks: {},
                subtask_id: 0,
            },
            model: defaultConfig.model,
            version: defaultConfig.version,
            tool_format: defaultConfig.tool_format,
            is_plugin: defaultConfig.is_plugin,
            compress_context: defaultConfig.compress_context,
            ...params
        } as ChatState;
    }

    public fixMessages() {
        if (!this.messages || this.messages.length === 0) return;

        const lastMessage: Message = this.messages[this.messages.length - 1];

        // 1. 如果最后一条是 user 消息（大模型还没开始回复就被打断），直接弹出
        if (lastMessage?.role === "user") {
            this.popMessage(lastMessage.group_id);
            return;
        }

        // 2. 往前寻找最近的一条 assistant 消息
        let lastAssistantIdx = -1;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
            }
        }

        if (lastAssistantIdx !== -1 && lastAssistantIdx !== this.messages.length - 1) {
            const assistantMsg = this.messages[lastAssistantIdx];

            // 3. 如果这个 assistant 消息包含了并发的工具调用
            if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
                
                // a. 收集在这之后已经成功返回结果的工具 ID
                const existingToolIds = new Set<string>();
                for (let i = lastAssistantIdx + 1; i < this.messages.length; i++) {
                    const msg = this.messages[i];
                    if (msg.role === 'tool' && msg.tool_call_id) {
                        existingToolIds.add(msg.tool_call_id);
                    }
                }

                // b. 遍历所有的工具调用，找出还没被回复的（被中断的）
                let hasInterruptedTools = false;
                for (const call of assistantMsg.tool_calls) {
                    if (!existingToolIds.has(call.id as string)) {
                        hasInterruptedTools = true;
                        // 为缺失的工具伪造一个“被中断”的回调消息，强制闭环
                        this.pushMessage({
                            role: 'tool',
                            content: "The task was interrupted by the user before execution.",
                            tool_call_id: call.id,
                            tool_call_name: call.function?.name,
                            group_id: assistantMsg.group_id,
                            context_id: assistantMsg.context_id,
                            show: false, // 补充的伪造消息没必要在界面渲染
                            react: false
                        });
                    }
                }

                // c. 如果确实有工具被中断，或者所有工具都刚执行完但还没给总结，统一补一句 Assistant 的结论
                if (hasInterruptedTools || lastMessage?.role === "tool") {
                    this.pushMessage({ 
                        role: 'assistant', 
                        content: "The user interrupted the task.", 
                        group_id: assistantMsg.group_id, 
                        context_id: assistantMsg.context_id,
                        show: true, 
                        react: false 
                    });
                }

            }
        }
    }

    public saveMessages(filePath: string) {
        try {
            if (!fs.existsSync(path.dirname(filePath))) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            }
            const data = {
                messages: this.messages.map(message => {
                    if (!message?.context_id && message.role == "assistant") {
                        message.context_id = message.group_id;
                    }
                    return message;
                }),
                chat: this.chat
            };

            fs.writeFile(filePath, JSON.stringify(data, null, 2), err => {
                if (err) {
                    logger.log(err.message);
                    return;
                }
                logger.log(`Save success: ${filePath}`);
            });
        } catch (error: any) {
            logger.log(error);
        }
    }

    public loadMessages(filePath: string): Message[] {
        try {
            if (!fs.existsSync(filePath)) {
                return [];
            }
            const data = utils.parseJsonContent(fs.readFileSync(filePath, "utf-8"));

            // 旧版数据格式兼容
            if (Array.isArray(data)) {
                this.messages = data || [];
                this.chat = this.getChatInit();
            } else if (data?.messages && data?.chat) {
                this.messages = data.messages;
                this.chat = data.chat;
            }
            this.fixMessages();
            this.updateChat();
            return this.messages.filter(message => message.show);
        } catch (error: any) {
            logger.log(error);
            return [];
        }
    }

    public loadFromChat(chat: ChatState): boolean {
        try {
            this.chat = chat;
            return true;
        } catch (error: any) {
            logger.log(error);
            return false;
        }
    }

    public toggleMessageGroup({ group_id, del, del_mode }: { group_id: string, del?: boolean, del_mode?: boolean }): number {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.group_id != group_id);
                this.updateChat();
            } else {
                this.messages = this.messages.map(message => {
                    if (message.group_id == group_id && del !== undefined) message.del = del;
                    return message;
                });
            }
            return this.messages.length;
        } catch (e: any) {
            return 0;
        }
    }

    public thumbMessageGroup({ group_id, thumb }: { group_id: string, thumb: number }): any {
        try {
            if (thumb === 0) {
                return {
                    type: "thumb",
                    data: this.messages.find(m => m.group_id === group_id)?.thumb || 0
                };
            } else {
                this.messages = this.messages.map(message => {
                    if (message.group_id === group_id) message.thumb = thumb; // 1:up 0:null -1:down
                    return message;
                });
                return {
                    type: "messages",
                    data: this.messages.filter(m => m.group_id === group_id)
                };
            }
        } catch (e: any) {
            return null;
        }
    }

    public toggleContextMessage({ context_id, del_mode }: { context_id: string, del_mode?: boolean }): number {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.context_id != context_id);
                this.updateChat();
            } else {
                this.messages = this.messages.map(message => {
                    if (message.context_id == context_id) {
                        message.del = Object.prototype.hasOwnProperty.call(message, "del") ? !message.del : true;
                    }
                    return message;
                });
            }
            return this.messages.length;
        } catch (e: any) {
            return 0;
        }
    }

    // 仅仅保留部分思考和调用工具名 (屏蔽过长内容节省 token)
    public delMessage(message: Message, truncateThinking = false): Message {
        let message_copy = utils.copy(message);
        if (typeof message_copy.content !== 'string') return message_copy;

        const content_parse = utils.parseJsonContent(message_copy.content);
        if (content_parse) {
            if (content_parse?.observation && message_copy.role === "user") {
                message_copy.content = `Assistant called ${content_parse.tool_call} tool...[User deleted this record]`;
            }
            if (message_copy.role === "assistant") {
                content_parse.params = "[User deleted this record]";
                if (truncateThinking && typeof content_parse.content === 'string' && content_parse.content.length > 50) {
                    content_parse.content = content_parse.content.slice(0, 50) + "…[User deleted this record]";
                }
                message_copy.content = JSON.stringify(content_parse);
            }
        }
        return message_copy;
    }

    public getStartIdx(data: Record<string, any>): number {
        let messages = this.getMessages(false);
        messages = this.compressContext(messages);
        let startIdx = Math.floor(messages.length / data.memory_length) * data.memory_length;
        if (startIdx > 0) {
            // 保留最近的一半上下文
            startIdx -= Math.floor(data.memory_length / 2);
        }
        let startMessage = messages[startIdx];
        // 如果最后一条消息是 tool 的话，startIdx - 1 表示上一条为 assistant 的消息
        if (startMessage?.role === "tool") {
            startIdx -= 1;
        }
        return startIdx;
    }

    public getMemory(data: Record<string, any>): Message[] {
        let messages = this.getMessages(false);
        messages = this.compressContext(messages);
        if (this.chat.tokens >= data.max_tokens || 1e5) {
            data.long_memory_length = Math.floor(data.long_memory_length);
            data.memory_length = Math.floor(data.memory_length);
        }
        // 截取最近记忆
        if (messages.length > data.memory_length) {
            let messages_list: Message[] = [];
            let startIdx = this.getStartIdx(data);
            let longStartIdx = Math.max(startIdx - data.long_memory_length, 0);
            messages_list = messages.slice(longStartIdx, startIdx).filter(message => message.role !== "tool").map(message => {
                const message_copy = this.delMessage(message, message?.del);
                return {
                    role: message_copy.role,
                    content: message_copy.content,
                    context_id: message_copy.context_id,
                };
            });
            let longMessages = JSON.stringify(messages_list, null, 2);
            let userMessage: Message = {
                role: "user",
                content: "# 🗃️ Session Memory (Context IDs)\n" + longMessages,
            }
            messages = messages.slice(startIdx, messages.length)
            // 在前面添加一条 user 消息
            messages.unshift(userMessage);
        }
        return messages;
    }
}