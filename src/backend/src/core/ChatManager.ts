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
                    if (lastMessage.id === message.id) {
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
        if (msg.role === "assistant") {
            this.chat.max_context_id += 1;
        }
        this.messages.push(msg);
        this.updateChat();
    }

    public popMessage(id?: string, context_id?: string): Message | null {
        if (this.messages.length > 0) {
            if (!id && !context_id) {
                const popped = this.messages.pop();
                this.updateChat();
                return popped || null;
            } else {
                this.messages = this.messages.filter(message => {
                    return !(message.id === id || message.context_id === context_id);
                });
                this.updateChat();
                return null;
            }
        }
        return null;
    }

    public envMessage(content: string): Message {
        return { role: "user", content: content } as Message;
    }

    public getChatId(): string {
        return `chat-${crypto.randomUUID()}`;
    }

    public getDefaultConfig() {
        const defaultConfig = utils.getConfig("default") || {};
        return {
            model: defaultConfig["model"] || "gpt-4",
            version: defaultConfig["version"] || "latest",
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
            max_index: 0,
            max_context_id: 0,
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
        const lastMessage: Message = this.messages[this.messages.length - 1];
        if (lastMessage?.role === "tool" && lastMessage?.tool_call_id) {
            this.pushMessage({ role: 'assistant', content: "The user interrupted the task.", id: lastMessage.id, show: true, react: false });
        }
        if (lastMessage?.role === "assistant" && lastMessage?.tool_calls) {
            delete lastMessage.tool_call_id;
            delete lastMessage.tool_calls;
            lastMessage.content += "\n\n**The user interrupted the task.**";
        }
        if (lastMessage?.role === "user") {
            this.popMessage(lastMessage.id);
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
                        message.context_id = message.id;
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

    public loadMessages(filePath: string): Message[] | boolean {
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
            return false;
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

    public toggleMessage({ id, del, del_mode }: { id: string, del?: boolean, del_mode?: boolean }): number {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.id != id);
                this.updateChat();
            } else {
                this.messages = this.messages.map(message => {
                    if (message.id == id && del !== undefined) message.del = del;
                    return message;
                });
            }
            return this.messages.length;
        } catch (e: any) {
            return 0;
        }
    }

    public thumbMessage({ id, thumb }: { id: string, thumb: number }): any {
        try {
            if (thumb === 0) {
                return {
                    type: "thumb",
                    data: this.messages.find(m => m.id === id)?.thumb || 0
                };
            } else {
                this.messages = this.messages.map(message => {
                    if (message.id === id) message.thumb = thumb; // 1:up 0:null -1:down
                    return message;
                });
                return {
                    type: "messages",
                    data: this.messages.filter(m => m.id === id)
                };
            }
        } catch (e: any) {
            return null;
        }
    }

    public toggleMemory({ context_id, del_mode }: { context_id: string, del_mode?: boolean }): number {
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
                if (truncateThinking && typeof content_parse.thinking === 'string' && content_parse.thinking.length > 50) {
                    content_parse.thinking = content_parse.thinking.slice(0, 50) + "…[User deleted this record]";
                }
                message_copy.content = JSON.stringify(content_parse);
            }
        }
        return message_copy;
    }

    public getMemory(memoryLength: number): Message[] {
        let messages = this.getMessages(false);
        messages = this.compressContext(messages);
        // 截取最近记忆
        return messages.slice(Math.max(messages.length - memoryLength, 0), messages.length);
    }
}