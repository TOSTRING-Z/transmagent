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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatManager = void 0;
const fs = __importStar(require("fs"));
const logger_1 = require("../utils/logger");
const path = __importStar(require("path"));
const globals_1 = require("../utils/globals");
const public_1 = require("../utils/public");
class ChatManager {
    messages = [];
    chat;
    tagSuccess = false;
    uuid;
    utils;
    constructor(messages = [], chatInitParams = {}, utils) {
        this.utils = utils;
        this.chat = this.getChatInit(chatInitParams);
        this.uuid = this.getUUID();
        this.initMessages(messages);
    }
    getUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    initMessages(messages = []) {
        this.messages = messages;
        this.tagSuccess = false;
        this.updateChat();
    }
    updateChat() {
        this.chat.msg_count = this.getMessages(false).length;
    }
    getMessages(all = true) {
        if (all)
            return (0, public_1.copy)(this.messages);
        let msgs = (0, public_1.copy)(this.messages.filter(message => !message?.del));
        return msgs;
    }
    compressContext(messages) {
        let msgs = (0, public_1.copy)(messages);
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
                    message.content = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + message.content.trim();
                }
                return message;
            });
        }
        return msgs;
    }
    pushMessage(msg, uuid) {
        if (this.uuid === uuid) {
            this.messages.push(msg);
            this.updateChat();
        }
    }
    pushSystemMessage(msg) {
        const systemMsg = { role: "system", content: msg.content };
        this.pushMessage(systemMsg, msg.uuid);
    }
    pushUserMessage(msg) {
        const userMsg = { role: "user", content: msg.content, group_id: msg.group_id, context_id: msg.context_id, show: true, react: false };
        this.pushMessage(userMsg, msg.uuid);
    }
    pushAssistantMessageWithToolCalls(msg) {
        const assistantMsg = { role: "assistant", content: msg.content, reasoning_content: msg.reasoning_content, thinking_signature: msg.thinking_signature, tool_calls: msg.tool_calls, group_id: msg.group_id, context_id: msg.context_id, show: true, react: true };
        this.pushMessage(assistantMsg, msg.uuid);
    }
    pushAssistantMessage(msg) {
        const assistantMsg = { role: "assistant", content: msg.content, reasoning_content: msg.reasoning_content, thinking_signature: msg.thinking_signature, group_id: msg.group_id, context_id: msg.context_id, show: true, react: false, del: !!msg?.del };
        this.pushMessage(assistantMsg, msg.uuid);
    }
    pushToolMessage(msg) {
        let toolMsg;
        if (this.chat.tool_format === "toolcalls") {
            toolMsg = { role: "tool", content: msg.content, tool_call_id: msg.tool_call_id, tool_call_name: msg.tool_call_name, group_id: msg.group_id, context_id: msg.context_id, show: true, react: true, del: !!msg?.del };
        }
        else {
            toolMsg = { role: "user", content: msg.content, group_id: msg.group_id, context_id: msg.context_id, show: true, react: true, del: !!msg?.del };
        }
        this.pushMessage(toolMsg, msg.uuid);
    }
    popMessage(group_id, context_id) {
        if (this.messages.length > 0) {
            if (!group_id && !context_id) {
                const popped = this.messages.pop();
                this.updateChat();
                return popped || null;
            }
            else {
                this.messages = this.messages.filter(message => {
                    return !(message.group_id === group_id || message.context_id === context_id);
                });
                this.updateChat();
                return null;
            }
        }
        return null;
    }
    getDefaultConfig() {
        return {
            model: this.utils.getConfig("default")["model"] || "deepseek[openai]",
            version: this.utils.getConfig("default")["version"] || "deepseek-chat",
            tool_format: this.utils.getConfig("default")["tool_format"] || "toolcalls",
            is_plugin: this.utils.getConfig("default")["model"] === "plugins",
            compress_context: this.utils.getConfig("default")["compress_context"] || false,
            memory_length: this.utils.getConfig('tool_call')["memory_length"] || 100,
            long_memory_length: this.utils.getConfig('tool_call')["long_memory_length"] || 200,
            max_tokens: this.utils.getConfig('tool_call')["max_tokens"] || 1e5,
        };
    }
    getChatInit(params = {}) {
        const defaultConfig = this.getDefaultConfig();
        return {
            id: (0, public_1.getSessionId)(),
            name: globals_1.CHAT_CONST.DEFAULT_NAME,
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
            ...defaultConfig,
            ...params
        };
    }
    fixMessages() {
        if (!this.messages || this.messages.length === 0 || this.chat.tool_format === "prompt")
            return;
        const lastMessage = this.messages[this.messages.length - 1];
        // 1. 如果最后一条是 user 消息，直接弹出
        if (lastMessage?.role === "user") {
            this.popMessage(lastMessage.group_id);
            return;
        }
        // 2. 往前找最近的一条 assistant 消息
        let lastAssistantIdx = -1;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === "assistant") {
                lastAssistantIdx = i;
                break;
            }
        }
        if (lastAssistantIdx === -1)
            return;
        const assistantMsg = this.messages[lastAssistantIdx];
        // 3. 如果 assistant 有 tool_calls，需要检查 tool 结果是否完整
        if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
            // 收集从 assistant 之后的所有 tool 结果 ID
            const existingToolIds = new Set();
            for (let i = lastAssistantIdx + 1; i < this.messages.length; i++) {
                const msg = this.messages[i];
                if (msg.role === "tool" && msg.tool_call_id) {
                    existingToolIds.add(msg.tool_call_id);
                }
            }
            // 为缺失的 tool 调用补充"被中断"的结果
            for (const call of assistantMsg.tool_calls) {
                if (!existingToolIds.has(call.id)) {
                    this.pushToolMessage({
                        content: "The user interrupted the task.",
                        tool_call_id: call.id,
                        tool_call_name: call.function?.name,
                        group_id: assistantMsg.group_id,
                        context_id: assistantMsg.context_id,
                        uuid: this.uuid,
                        del: assistantMsg.del
                    });
                }
            }
            // 添加中断提示
            this.pushAssistantMessage({
                content: "The user interrupted the task.",
                group_id: assistantMsg.group_id,
                context_id: assistantMsg.context_id,
                uuid: this.uuid,
                del: assistantMsg.del
            });
        }
    }
    saveMessages(filePath) {
        try {
            if (!fs.existsSync(path.dirname(filePath))) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            }
            const data = {
                messages: this.messages.map(message => {
                    if (message.role == "assistant" && !message?.context_id) {
                        message.context_id = message.group_id;
                    }
                    return message;
                }),
                chat: this.chat
            };
            fs.writeFile(filePath, JSON.stringify(data, null, 2), err => {
                if (err) {
                    logger_1.logger.log(err.message);
                    return;
                }
                logger_1.logger.log(`Save success: ${filePath}`);
            });
        }
        catch (error) {
            logger_1.logger.log(error);
        }
    }
    loadMessages(filePath) {
        try {
            logger_1.logger.log("loading messages...", filePath);
            if (!fs.existsSync(filePath)) {
                return [];
            }
            const data = (0, public_1.parseJsonContent)(fs.readFileSync(filePath, "utf-8"));
            this.messages = data?.messages || [];
            this.chat = this.getChatInit(data.chat);
            this.updateChat();
            return this.messages.filter(message => message.show);
        }
        catch (error) {
            logger_1.logger.log(error);
            return [];
        }
    }
    loadFromChat(chat) {
        try {
            this.chat = chat;
            return true;
        }
        catch (error) {
            logger_1.logger.log(error);
            return false;
        }
    }
    toggleMessageGroup({ group_id, del, del_mode }) {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.group_id != group_id);
                this.updateChat();
            }
            else {
                this.messages = this.messages.map(message => {
                    if (message.group_id == group_id && del !== undefined)
                        message.del = del;
                    return message;
                });
            }
            return this.messages.length;
        }
        catch (e) {
            return 0;
        }
    }
    thumbMessageGroup({ group_id, thumb }) {
        try {
            if (thumb === 0) {
                return {
                    type: "thumb",
                    data: this.messages.find(m => m.group_id === group_id)?.thumb || 0
                };
            }
            else {
                this.messages = this.messages.map(message => {
                    if (message.group_id === group_id)
                        message.thumb = thumb; // 1:up 0:null -1:down
                    return message;
                });
                return {
                    type: "messages",
                    data: this.messages.filter(m => m.group_id === group_id)
                };
            }
        }
        catch (e) {
            return null;
        }
    }
    toggleContextMessage({ context_id, del_mode }) {
        try {
            if (del_mode) {
                this.messages = this.messages.filter(message => message.context_id != context_id);
                this.updateChat();
            }
            else {
                this.messages = this.messages.map(message => {
                    if (message.context_id == context_id) {
                        message.del = Object.prototype.hasOwnProperty.call(message, "del") ? !message.del : true;
                    }
                    return message;
                });
            }
            return this.messages.length;
        }
        catch (e) {
            return 0;
        }
    }
    // 仅仅保留部分思考和调用工具名 (屏蔽过长内容节省 token)
    delMessage(message, truncateThinking = false) {
        let message_copy = (0, public_1.copy)(message);
        if (typeof message_copy.content !== 'string')
            return message_copy;
        const content_parse = (0, public_1.parseJsonContent)(message_copy.content);
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
    getStartIdx() {
        let messages = this.getMessages(false);
        messages = this.compressContext(messages);
        let startIdx = Math.floor(messages.length / this.chat.memory_length) * this.chat.memory_length;
        if (startIdx > 0) {
            // 保留最近的一半上下文
            startIdx -= Math.floor(this.chat.memory_length / 2);
        }
        // 可能有多条连续的 tool 消息，需要一直向前找到最近的 assistant 消息
        while (startIdx > 0 && messages[startIdx]?.role === "tool") {
            startIdx -= 1;
        }
        return startIdx;
    }
    getMemory() {
        let messages = this.getMessages(false);
        messages = this.compressContext(messages);
        // 截取最近记忆
        if (messages.length > this.chat.memory_length) {
            let startIdx = this.getStartIdx();
            let longStartIdx = Math.max(startIdx - this.chat.long_memory_length, 0);
            // 直接映射为 Markdown 格式的字符串
            let longMessagesStr = messages
                .slice(longStartIdx, startIdx)
                .filter(message => message.role !== "tool")
                .map(message => {
                const message_copy = this.delMessage(message, message?.del);
                // 使用 Markdown 格式：加粗角色名和 ID，正文跟在后面
                return `**[${message_copy.role.toUpperCase()}]** (Context ID: ${message_copy.context_id})\n${message_copy.content}`;
            })
                .join("\n\n---\n\n"); // 使用分割线区分每一条消息
            let userMessage = {
                role: "user",
                content: "# 🗃️ Session Memory (Context IDs)\n\n" + longMessagesStr,
            };
            messages = messages.slice(startIdx, messages.length);
            // 在前面添加一条 user 消息
            messages.unshift(userMessage);
        }
        return messages;
    }
}
exports.ChatManager = ChatManager;
//# sourceMappingURL=ChatManager.js.map