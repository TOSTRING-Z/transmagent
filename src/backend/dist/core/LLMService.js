"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMService = void 0;
const ChatManager_1 = require("./ChatManager");
const logger_1 = require("../utils/logger");
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
        this.adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter("openai"); // 默认 API 适配器
    }
    stopLoop() {
        this.stopFlag = true;
    }
    startLoop() {
        this.stopFlag = false;
    }
    async chatBase(data) {
        try {
            // 1. 根据 api_type 获取 API 通信适配器
            this.adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter(data.api_type);
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
            messagesList = messagesList.concat(this.chatManager.getMemory());
            const messageInput = { role: "user", content: content, group_id: this.chatManager.chat.group_id, show: true, react: false };
            if (data?.llm_conversation_mode) {
                messagesList.push(messageInput);
            }
            let messageOutput = { role: 'assistant', content: '', group_id: this.chatManager.chat.group_id, show: true, react: false };
            // 4. 构建 HTTP 发送载荷
            const formattedMessages = this.adapter.formatMessages(messagesList, data);
            const body = this.adapter.buildPayload(data, formattedMessages);
            const headers = this.adapter.buildHeaders(data);
            if (this.stopFlag) {
                return null;
            }
            // 5. 发起请求
            const resp = await fetch(new URL(data.api_url), {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
            });
            // 6. 流式与非流式分流处理
            let status;
            if (resp.ok) {
                if (body?.stream) {
                    status = await this.handleStream(resp, this.adapter, data, messageOutput);
                }
                else {
                    status = await this.handleNormal(resp, this.adapter, headers, body, data, messageOutput);
                }
                if (!status) {
                    return null;
                }
            }
            else {
                const errorText = await resp.text();
                logger_1.logger.error(`HTTP Error ${resp.status}: ${errorText}`);
                this.window?.webContents.send('infoData', {
                    ...this.chatManager.chat,
                    content: `Response error: ${errorText}\n`
                });
                return null;
            }
            if (this.stopFlag) {
                return null;
            }
            // 7. 处理并序列化 Tool Calls
            data.output = messageOutput.content;
            if (data.end) {
                if (!data?.llm_conversation_mode)
                    return messageOutput; // 只需返回
                const finalResponseText = data.output_template ? (0, format_1.formatString)(data.output_template, { ...data }) : data.output;
                this.window?.webContents.send('streamData', {
                    ...this.chatManager.chat,
                    content_reasoning: messageOutput.reasoning_content,
                    content: data.react ? `\n\n${finalResponseText}` : "",
                    end: true
                });
            }
            return messageOutput;
        }
        catch (error) {
            logger_1.logger.error(error);
            this.window?.webContents.send('infoData', {
                ...this.chatManager.chat,
                content: `Response error: ${error.message}\n`
            });
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
                return false;
            const { content, reasoning_content, tool_calls, tokens, is_incremental_tokens } = adapter.parseStreamChunk(chunk);
            // 组装文本内容
            if (content) {
                messageOutput.content += content;
            }
            // 组装 reasoning_content
            if (reasoning_content) {
                messageOutput.reasoning_content = (messageOutput.reasoning_content || "") + reasoning_content;
            }
            // 组装并拼凑碎片的 Tool Calls (统一处理 OpenAI 和 Anthropic 格式)
            if (tool_calls) {
                if (!messageOutput.tool_calls)
                    messageOutput.tool_calls = [];
                for (const tc of tool_calls) {
                    if (tc.index !== undefined) {
                        // OpenAI 格式
                        if (!messageOutput.tool_calls[tc.index]) {
                            messageOutput.tool_calls[tc.index] = {
                                id: tc.id,
                                type: "function",
                                function: { name: tc.function?.name || "", arguments: "" }
                            };
                        }
                        const currentToolCall = messageOutput.tool_calls[tc.index];
                        if (tc.function?.arguments && currentToolCall?.function) {
                            currentToolCall.function.arguments += tc.function.arguments;
                        }
                    }
                    else {
                        // Anthropic 格式或其他直接返回的格式
                        messageOutput.tool_calls.push(tc);
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
            if (!data?.react && data?.llm_conversation_mode) {
                this.window?.webContents.send('streamData', {
                    ...this.chatManager.chat,
                    content: content,
                    reasoning_content: reasoning_content
                });
            }
        }
        return true;
    }
    async handleNormal(resp, adapter, headers, body, data, messageOutput) {
        let respJson;
        try {
            respJson = await resp.json();
        }
        catch (error) {
            console.error(error);
            this.window?.webContents.send('infoData', {
                ...this.chatManager.chat,
                content: `Response error: ${error.message}\n`
            });
            return false;
        }
        const { content, reasoning_content, tool_calls, finish_reason, tokens } = adapter.parseResponse(respJson);
        data.output = content;
        messageOutput.content = content;
        if (reasoning_content)
            messageOutput.reasoning_content = reasoning_content;
        if (tool_calls) {
            messageOutput.tool_calls = tool_calls;
        }
        if (tokens)
            this.chatManager.chat.tokens = tokens;
        if (!data?.react && data?.llm_conversation_mode) {
            this.window?.webContents.send('streamData', { ...this.chatManager.chat, content: `\n\n${data.output}`, reasoning_content: reasoning_content });
        }
        // ========== 截断检测与自动续传机制 (Max: 3) ==========
        if (finish_reason === "length" && data.output) {
            await adapter.truncatedResponse(body, headers, this.window, this.chatManager, messageOutput, data);
        }
        return true;
    }
}
exports.LLMService = LLMService;
//# sourceMappingURL=LLMService.js.map