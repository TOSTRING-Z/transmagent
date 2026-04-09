"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIToolCallAdapter = exports.OpenAIAdapter = void 0;
const json5_1 = __importDefault(require("json5"));
const partial_json_1 = require("partial-json");
class OpenAIAdapter {
    formatMessages(messages, data) {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const messageCopy = {
                role: message.role,
                content: message.content
            };
            if (message.role === "tool" && message.tool_call_id) {
                messageCopy.tool_call_id = message.tool_call_id;
                if (typeof messageCopy.content !== 'string') {
                    messageCopy.content = JSON.stringify(messageCopy.content);
                }
            }
            if (message.role === "assistant" && message.tool_calls) {
                messageCopy.tool_calls = message.tool_calls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.function?.name || tc.name,
                        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
                    }
                }));
            }
            // 2. 视觉模型参数处理
            if (!data.params?.vision) {
                // 非视觉模型：如果是数组内容，提取出纯文本
                if (Array.isArray(messageCopy.content)) {
                    messageCopy.content = messageCopy.content
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join('\n');
                }
            }
            else {
                // 视觉模型：根据支持的媒体类型进行过滤
                if (Array.isArray(messageCopy.content)) {
                    messageCopy.content = messageCopy.content.filter((c) => {
                        switch (c.type) {
                            case "image_url":
                                return data.params.vision.includes("image");
                            case "video_url":
                                return data.params.vision.includes("video");
                            case "text":
                                return true;
                            default:
                                return false;
                        }
                    });
                }
            }
            return messageCopy;
        });
        if (data.env_message) {
            formattedMessages[formattedMessages.length - 1].content += `\n${data.env_message}`;
        }
        if (data.todolist_message) {
            formattedMessages[formattedMessages.length - 1].content += `\n${data.todolist_message}`;
        }
        return formattedMessages;
    }
    buildPayload(data, formattedMessages) {
        const body = {
            model: data.version,
            messages: formattedMessages,
            ...data.llm_params
        };
        // 处理 OpenAI 规范的 Function Calling
        if (data.tools && data.tools.length > 0) {
            body.tools = data.tools;
            body.tool_choice = "auto";
        }
        // 默认启用 Usage 统计 (Claude 不支持此参数，原逻辑做了排除)
        if (body.stream && !body.stream_options && data.version && !data.version.includes("claude")) {
            body.stream_options = { include_usage: true };
        }
        return body;
    }
    buildHeaders(data) {
        const headers = { "Content-Type": "application/json" };
        if (data?.api_key)
            headers["Authorization"] = `Bearer ${data.api_key}`;
        return headers;
    }
    parseStreamChunk(chunk) {
        let content = "";
        let reasoning_content = "";
        let tool_calls = undefined;
        let tokens = undefined;
        let finish_reason = undefined;
        if (chunk.message?.content) {
            content = chunk.message.content;
        }
        else {
            const delta = chunk.choices?.[0]?.delta;
            if (delta) {
                if (delta.reasoning_content) {
                    reasoning_content = delta.reasoning_content;
                }
                else if (delta.content) {
                    content = delta.content;
                }
                if (delta.tool_calls) {
                    tool_calls = delta.tool_calls;
                }
            }
        }
        // 解析 stop_reason / finish_reason（用于判断是否被 max_tokens 截断）
        if (chunk.choices?.[0]?.stop_reason) {
            finish_reason = chunk.choices[0].stop_reason;
        }
        else if (chunk.choices?.[0]?.finish_reason) {
            finish_reason = chunk.choices[0].finish_reason;
        }
        else if (chunk.delta?.stop_reason) {
            finish_reason = chunk.delta.stop_reason;
        }
        // 兼容不同的 token 统计返回格式
        if (chunk.usage?.total_tokens) {
            tokens = chunk.usage.total_tokens;
        }
        else if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }
        return { content, reasoning_content, tool_calls, tokens, finish_reason };
    }
    parseResponse(respJson) {
        let content = "";
        let reasoning_content = "";
        let tool_calls = undefined;
        let finish_reason = "";
        if (respJson.message) {
            content = respJson.message.content;
            // OpenAI 兼容格式的 thinking/reasoning
            if (respJson.message.reasoning_content) {
                reasoning_content = respJson.message.reasoning_content;
            }
        }
        else {
            const choice = respJson.choices?.[0];
            content = choice?.message?.content || "";
            tool_calls = choice?.message?.tool_calls;
            finish_reason = choice?.finish_reason || "";
        }
        return {
            content,
            reasoning_content,
            tool_calls,
            finish_reason,
            tokens: respJson.usage?.total_tokens
        };
    }
    async truncatedResponse(body, headers, window, chatManager, messageOutput, data) {
        let continuationCount = 0;
        const maxContinuations = 3;
        let isToolCallTruncated = messageOutput.tool_calls && messageOutput.tool_calls.length > 0;
        let content = isToolCallTruncated ? messageOutput.tool_calls[0].function.arguments : data.output;
        let partialContent = isToolCallTruncated
            ? content +
                `\n\n⚠️ SYSTEM ERROR: JSON content was truncated at ${content.length} characters, causing a fatal parse error. \n\n` +
                `DO NOT attempt to output this entire payload in a single response again. You MUST break the data into smaller chunks and use a batch-processing approach (e.g., writing/processing a few lines or items at a time). Retry with a significantly smaller JSON payload.`
            : content;
        let baseMessages = [...body.messages];
        if (!isToolCallTruncated) {
            while (continuationCount < maxContinuations) {
                continuationCount++;
                let currentPrompt = `Your previous response was truncated due to length limits.\n\nHere is what you have output so far:\n${partialContent}\n\nPlease output ONLY the exact continuation. Do not repeat what is already generated above.`;
                const continuationMessages = [
                    ...baseMessages,
                    { role: "user", content: currentPrompt }
                ];
                const continuationBody = { ...body, messages: continuationMessages };
                try {
                    const contResp = await fetch(new URL(data.api_url), {
                        method: "POST", headers, body: JSON.stringify(continuationBody)
                    });
                    const contRespJson = await contResp.json();
                    if (contRespJson.error) {
                        console.error("[OpenAI Continuation Error]", contRespJson.error);
                        break;
                    }
                    const parsedCont = this.parseResponse(contRespJson);
                    let newContent = parsedCont.content || "";
                    // 拼接内容
                    partialContent += newContent;
                    data.output = partialContent;
                    messageOutput.content = data.output;
                    if (!data?.react && data?.llm_conversation_mode) {
                        window?.webContents.send('streamData', {
                            group_id: chatManager.chat.group_id,
                            content: newContent,
                            end: false,
                            chat: chatManager.chat,
                            is_tool_call_args: isToolCallTruncated
                        });
                    }
                    if (parsedCont.tokens)
                        chatManager.chat.tokens = parsedCont.tokens;
                    // 如果不是因为长度截断，说明大模型认为自己补全完毕了，跳出循环
                    if (parsedCont.finish_reason !== "length") {
                        console.log(`[OpenAI Continuation] Completed after ${continuationCount} continuation(s)`);
                        break;
                    }
                }
                catch (error) {
                    console.error("[OpenAI Continuation Error]", error);
                    break;
                }
            }
        }
        else {
            try {
                partialContent = JSON.stringify((0, partial_json_1.parse)(partialContent));
            }
            catch (error) { }
        }
        messageOutput.tool_calls[0].function.arguments = partialContent;
    }
    getConversationalURL(baseUrl) {
        return `${baseUrl}/chat/completions`;
    }
}
exports.OpenAIAdapter = OpenAIAdapter;
class OpenAIToolCallAdapter {
    formatTools(toolSchemas) {
        return toolSchemas.map(schema => {
            if (schema.type === "raw_string")
                return null;
            return { type: "function", function: schema };
        }).filter(Boolean);
    }
    getToolInfos(message) {
        let toolInfos = [];
        const reasoningContent = message.reasoning_content || "";
        const textContent = message.content || "";
        if (message?.tool_calls && message.tool_calls.length > 0) {
            for (let call of message.tool_calls) {
                try {
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: textContent,
                        tool_call_name: call?.function?.name ?? null,
                        tool_call_id: call?.id ?? null,
                        params: call?.function?.arguments ? json5_1.default.parse(call.function.arguments) : {},
                        error: null
                    });
                }
                catch (error) {
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: textContent,
                        tool_call_name: call?.function?.name ?? null,
                        tool_call_id: call?.id ?? null,
                        params: call?.function?.arguments,
                        error: `Arguments are not a pure JSON text, or there is a problem with the JSON format: ${error.message}`
                    });
                }
            }
        }
        else {
            toolInfos.push({ reasoning_content: reasoningContent || null, content: textContent, tool_call_name: null, tool_call_id: null, params: {}, error: null });
        }
        return toolInfos;
    }
    extractText(message) {
        return typeof message.content === 'string' ? message.content : "";
    }
}
exports.OpenAIToolCallAdapter = OpenAIToolCallAdapter;
//# sourceMappingURL=OpenAIAdapter.js.map