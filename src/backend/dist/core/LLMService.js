"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMService = void 0;
const ChatManager_1 = require("./ChatManager");
const AdapterFactory_1 = require("../factories/AdapterFactory");
const stream_1 = require("../utils/stream");
const format_1 = require("../utils/format"); // 原型扩展 format 的替代品
class LLMService {
    window;
    chatManager;
    stopFlag = false;
    adapter;
    constructor(messages = [], window = null) {
        this.window = window;
        this.chatManager = new ChatManager_1.ChatManager(messages);
        this.adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter("prompt"); // 默认适配器
    }
    stopMessage() {
        this.stopFlag = true;
    }
    startMessage() {
        this.stopFlag = false;
    }
    async chatBase(data) {
        try {
            // 1. 获取对应数据结构适配器
            this.adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter(this.chatManager.chat.tool_format);
            // 2. 输入数据清洗与格式化
            let content;
            if (data?.img_url) {
                content = [
                    { type: "text", text: data.input },
                    { type: "image_url", image_url: { url: data.img_url } }
                ];
            }
            else {
                content = data.input;
            }
            // 3. 构建消息上下文记录
            let messagesList = [];
            if (data.system_prompt) {
                messagesList.push({ role: "system", content: data.system_prompt, show: true, react: false });
            }
            messagesList = messagesList.concat(this.chatManager.getMemory(data));
            const messageInput = { role: "user", content: content, group_id: this.chatManager.chat.group_id, show: true, react: false };
            if (data?.push_message) {
                messagesList.push(messageInput);
            }
            let messageOutput = { role: 'assistant', content: '', group_id: this.chatManager.chat.group_id, show: true, react: false };
            // 4. 构建 HTTP 发送载荷
            const formattedMessages = this.adapter.formatMessages(messagesList, data.params, data?.env_message);
            const body = this.adapter.buildPayload(data, formattedMessages);
            const headers = this.adapter.buildHeaders(data);
            if (this.stopFlag) {
                this.stopFlag = false;
                messageOutput = { role: 'assistant', content: "The user interrupted the task.", group_id: this.chatManager.chat.group_id, show: true, react: false };
                return messageOutput;
            }
            // 5. 发起请求
            const resp = await fetch(new URL(data.api_url), {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
            });
            // 6. 流式与非流式分流处理
            if (resp.ok) {
                if (body?.stream) {
                    await this.handleStream(resp, this.adapter, data, messageOutput);
                }
                else {
                    await this.handleNormal(resp, this.adapter, headers, body, data, messageOutput);
                }
            }
            else {
                const errorText = await resp.text();
                messageOutput.content = `HTTP Error ${resp.status}: ${errorText}`;
                data.output = messageOutput.content;
                return messageOutput;
            }
            if (this.stopFlag) {
                messageOutput = { role: 'assistant', content: "The user interrupted the task.", group_id: this.chatManager.chat.group_id, show: true, react: false };
                return messageOutput;
            }
            // 7. 处理并序列化 Tool Calls
            data.output = messageOutput.content;
            if (data.end) {
                if (data?.return_response)
                    return messageOutput; // 只需返回
                const finalResponseText = data.output_template ? (0, format_1.formatString)(data.output_template, { ...data }) : data.output;
                this.window?.webContents.send('streamData', {
                    group_id: this.chatManager.chat.group_id,
                    content: data.react ? finalResponseText : "",
                    end: true,
                    chat: this.chatManager.chat
                });
            }
            return messageOutput;
        }
        catch (error) {
            console.error(error);
            if (!data?.return_response) {
                this.window?.webContents.send('infoData', {
                    group_id: this.chatManager.chat.group_id,
                    content: `Response error: ${error.message}\n`
                });
            }
            return null;
        }
    }
    async handleStream(resp, adapter, data, messageOutput) {
        const contentType = resp.headers.get('content-type');
        let streamRes;
        if (contentType && contentType.includes('text/event-stream')) {
            streamRes = (0, stream_1.streamSse)(resp);
        }
        else {
            streamRes = (0, stream_1.streamJSON)(resp);
        }
        for await (const chunk of streamRes) {
            if (this.stopFlag)
                return;
            const { content, reasoning_content, tool_calls, tokens, is_incremental_tokens } = adapter.parseStreamChunk(chunk);
            // 组装文本
            let textDelta = content || reasoning_content || "";
            if (textDelta) {
                messageOutput.content += textDelta;
            }
            // 组装并拼凑碎片的 Tool Calls
            if (this.chatManager.chat.tool_format === "openai" && tool_calls) {
                if (!messageOutput.tool_calls)
                    messageOutput.tool_calls = [];
                for (let tc of tool_calls) {
                    if (tc.index !== undefined) {
                        if (!messageOutput.tool_calls[tc.index]) {
                            messageOutput.tool_calls[tc.index] = {
                                id: tc.id,
                                type: "function",
                                function: { name: tc.function?.name || "", arguments: "" }
                            };
                        }
                        // @ts-ignore
                        if (tc.function?.name && messageOutput.tool_calls[tc.index])
                            messageOutput.tool_calls[tc.index].function.name += tc.function.name;
                        // @ts-ignore
                        if (tc.function?.arguments && messageOutput.tool_calls[tc.index])
                            messageOutput.tool_calls[tc.index].function.arguments += tc.function.arguments;
                    }
                }
            }
            // 更新 token
            if (tokens) {
                if (is_incremental_tokens) {
                    this.chatManager.chat.tokens = (this.chatManager.chat.tokens || 0) + tokens;
                }
                else {
                    this.chatManager.chat.tokens = tokens;
                }
            }
            // IPC 向前台推流
            if (!data?.react && !data?.return_response) {
                this.window?.webContents.send('streamData', {
                    group_id: this.chatManager.chat.group_id,
                    content: textDelta,
                    end: false,
                    chat: this.chatManager.chat
                });
            }
        }
    }
    async handleNormal(resp, adapter, headers, body, data, messageOutput) {
        let respJson;
        try {
            // 添加超时控制
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Response timeout')), 10000); // 10秒超时
            });
            respJson = await Promise.race([resp.json(), timeoutPromise]);
        }
        catch (err) {
            console.error(err);
            return;
        }
        if (respJson.error && !data?.return_response) {
            this.window?.webContents.send('infoData', {
                group_id: this.chatManager.chat.group_id,
                content: `POST Error:\n\`\`\`\n${respJson.error.message}\n\`\`\`\n`
            });
            return;
        }
        const { content, tool_calls, finish_reason, tokens } = adapter.parseResponse(respJson);
        data.output = content;
        messageOutput.content = content;
        if (tool_calls)
            messageOutput.tool_calls = tool_calls;
        if (tokens)
            this.chatManager.chat.tokens = tokens;
        if (!data?.react && !data?.return_response) {
            this.window?.webContents.send('streamData', { group_id: this.chatManager.chat.group_id, content: data.output, end: false, chat: this.chatManager.chat });
        }
        // ========== 截断检测与自动续传机制 (Max: 3) ==========
        if (finish_reason === "length" && data.output) {
            await adapter.truncatedResponse(body, headers, this.window, this.chatManager, messageOutput, data);
        }
    }
}
exports.LLMService = LLMService;
//# sourceMappingURL=LLMService.js.map