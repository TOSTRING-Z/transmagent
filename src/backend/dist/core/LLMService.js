"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMService = void 0;
const ChatManager_1 = require("./ChatManager");
const logger_1 = require("../utils/logger");
const AdapterFactory_1 = require("../factories/AdapterFactory");
const stream_1 = require("../utils/stream");
const format_1 = require("../utils/format");
class LLMService {
    window;
    chatManager;
    stopFlag = false;
    adapter;
    utils;
    environment_details = {};
    constructor(messages = [], window = null, utils, agentMode = "transagent") {
        this.window = window;
        this.utils = utils;
        this.chatManager = new ChatManager_1.ChatManager(messages, { agentMode }, utils);
        this.adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter("openai");
    }
    stopLoop() {
        this.stopFlag = true;
        this.chatManager.uuid = this.chatManager.getUUID();
    }
    startLoop() {
        this.stopFlag = false;
        this.chatManager.uuid = this.chatManager.getUUID();
    }
    async chatBase(data) {
        try {
            // 1. 根据 api_type 获取 API 通信适配器
            this.adapter = AdapterFactory_1.LLMAdapterFactory.getAdapter(data.api_type);
            // 2. 构建消息上下文记录
            let messagesList = [];
            if (data.system_prompt) {
                messagesList.push({ role: "system", content: data.system_prompt, show: true, react: false });
            }
            messagesList = messagesList.concat(this.chatManager.getMemory());
            if (data?.llm_conversation_mode) {
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
                const messageInput = { role: "user", content: content, group_id: this.chatManager.chat.group_id, show: true, react: false };
                messagesList.push(messageInput);
            }
            let messageOutput = { role: 'assistant', content: '', group_id: this.chatManager.chat.group_id, show: true, react: false };
            // 3. 构建 HTTP 发送载荷
            const formattedMessages = this.adapter.formatMessages(messagesList, data);
            const body = this.adapter.buildPayload(data, formattedMessages);
            const headers = this.adapter.buildHeaders(data);
            if (this.stopFlag) {
                return null;
            }
            // 4. 发起请求
            const resp = await fetch(new URL(data.api_url), {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
            });
            // 5. 流式与非流式分流处理
            let status;
            if (resp.ok) {
                if (body?.stream) {
                    status = await this.handleStream(resp, this.adapter, headers, body, data, messageOutput);
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
                    content: `Response error: ${errorText}\n`,
                    uuid: data.uuid
                });
                return null;
            }
            if (this.stopFlag) {
                return null;
            }
            // 6. 处理并序列化 Tool Calls
            data.output = messageOutput.content;
            if (data.end && data?.llm_conversation_mode) {
                const finalResponseText = data.output_template ? (0, format_1.formatString)(data.output_template, { ...data }) : data.output;
                this.window?.webContents.send('streamData', {
                    ...this.chatManager.chat,
                    content_reasoning: messageOutput.reasoning_content,
                    content: data.react ? `\n\n${finalResponseText}` : "",
                    uuid: data.uuid,
                    end: true
                });
            }
            return messageOutput;
        }
        catch (error) {
            logger_1.logger.error(error);
            this.window?.webContents.send('infoData', {
                ...this.chatManager.chat,
                content: `Response error: ${error.message}\n`,
                uuid: data.uuid
            });
            return null;
        }
    }
    async handleStream(resp, adapter, headers, body, data, messageOutput) {
        const contentType = resp.headers.get('content-type');
        let streamRes;
        if (contentType && contentType.includes('text/event-stream')) {
            streamRes = (0, stream_1.streamSse)(resp);
        }
        else {
            streamRes = (0, stream_1.streamJSON)(resp);
        }
        let final_tokens = 0;
        let finish_reason = undefined;
        let chunk;
        for await (chunk of streamRes) {
            if (this.stopFlag)
                return false;
            const parsedChunk = adapter.parseStreamChunk(chunk);
            const { content, reasoning_content, tool_calls, tokens, is_incremental_tokens, finish_reason: chunkFinishReason } = parsedChunk;
            // 捕获截断原因
            if (chunkFinishReason) {
                finish_reason = chunkFinishReason;
            }
            // 组装文本内容
            if (content) {
                messageOutput.content += content;
            }
            // 组装 reasoning_content
            if (reasoning_content) {
                messageOutput.reasoning_content = (messageOutput.reasoning_content || "") + reasoning_content;
            }
            // 组装并拼凑碎片的 Tool Calls
            if (tool_calls) {
                if (!messageOutput.tool_calls)
                    messageOutput.tool_calls = [];
                for (const tc of tool_calls) {
                    if (tc.index !== undefined) {
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
                        messageOutput.tool_calls.push(tc);
                    }
                }
            }
            // 更新 token
            if (tokens) {
                if (is_incremental_tokens) {
                    final_tokens += tokens;
                }
                else {
                    final_tokens = tokens;
                }
            }
            // IPC 向前台推流
            if (!data?.react && data?.llm_conversation_mode) {
                this.window?.webContents.send('streamData', {
                    ...this.chatManager.chat,
                    content: content,
                    reasoning_content: reasoning_content,
                    uuid: data.uuid
                });
            }
        }
        this.chatManager.chat.tokens = final_tokens;
        if (messageOutput.tool_calls) {
            messageOutput.tool_calls = messageOutput.tool_calls.filter(Boolean);
        }
        // ========== 截断检测与自动续传机制 (Max: 3) ==========
        if ((finish_reason === "length" || finish_reason === "max_tokens" || finish_reason === "stop_sequence") && this.chatManager.chat.tool_format === "toolcalls") {
            await adapter.truncatedResponse(body, headers, this.window, this.chatManager, messageOutput, data);
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
                content: `Response error: ${error.message}\n`,
                uuid: data.uuid
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
            this.window?.webContents.send('streamData', {
                ...this.chatManager.chat,
                content: `\n\n${data.output}`,
                reasoning_content: reasoning_content,
                uuid: data.uuid
            });
        }
        // ========== 截断检测与自动续传机制 (Max: 3) ==========
        if ((finish_reason === "length" || finish_reason === "max_tokens" || finish_reason === "stop_sequence") && data.output && this.chatManager.chat.tool_format === "toolcalls") {
            await adapter.truncatedResponse(body, headers, this.window, this.chatManager, messageOutput, data);
        }
        return true;
    }
}
exports.LLMService = LLMService;
//# sourceMappingURL=LLMService.js.map