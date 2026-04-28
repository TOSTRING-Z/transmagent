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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaToolCallAdapter = exports.OllamaAdapter = void 0;
const json5_1 = __importDefault(require("json5"));
const utils = __importStar(require("../utils/public"));
const logger_1 = require("../utils/logger");
/**
 * OllamaAdapter - 专门适配 Ollama 本地模型的 API 调用
 *
 * Ollama API 特点:
 * 1. 使用 /api/chat 端点
 * 2. 消息格式兼容 OpenAI，但内容通过 message.content 返回
 * 3. 支持流式响应 (stream: true)
 * 4. token 统计使用 prompt_eval_count 和 eval_count
 * 5. 模型列表通过 /api/tags 获取
 */
class OllamaAdapter {
    formatMessages(messages, data) {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const role = message.role === "tool" ? "user" : message.role; // tool角色转换为user
            let messageCopy = {
                role: role,
                content: ""
            };
            // 2. 视觉模型参数处理 - Ollama 视觉模型如 llama3.2-vision
            if (data.params?.vision) {
                if (Array.isArray(message.content)) {
                    const textObj = message.content.find((c) => c.type === "text");
                    const imgObj = message.content.find((c) => c.type === "image_url");
                    if (textObj && imgObj) {
                        // 提取 base64 编码的图片
                        const base64Image = imgObj.image_url.url.split(",")[1];
                        messageCopy = {
                            role: role,
                            content: textObj.text || "",
                            images: [base64Image]
                        };
                        return messageCopy;
                    }
                }
            }
            else {
                // 非视觉模型：如果是数组内容，提取出纯文本
                if (Array.isArray(message.content)) {
                    messageCopy.content = message.content
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join('\n');
                }
                else {
                    messageCopy.content = message.content;
                }
            }
            // 回传 reasoning_content（扩展思考/思维链模式必需）
            if (message.role === "assistant") {
                messageCopy.reasoning_content = message?.reasoning_content || "";
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
    buildPayload(data, messages) {
        // 构建 Ollama 特定的请求体
        const payload = {
            model: data.version,
            messages: messages.map(msg => {
                if (msg.role === "tool") {
                    return {
                        role: "user",
                        content: msg.content
                    };
                }
                return msg;
            }),
            stream: true
        };
        // 添加可选参数
        if (data.llm_params) {
            // Ollama 支持的参数
            const ollamaParams = ['temperature', 'top_p', 'top_k', 'num_predict', 'stop', 'raw'];
            for (const param of ollamaParams) {
                if (data.llm_params[param] !== undefined) {
                    payload[param] = data.llm_params[param];
                }
            }
            // 处理 chat_template_kwargs (如 enable_thinking)
            if (data.llm_params.chat_template_kwargs) {
                payload.options = { ...payload.options, ...data.llm_params.chat_template_kwargs };
            }
        }
        return payload;
    }
    buildHeaders(data) {
        return { "Content-Type": "application/json" };
    }
    parseStreamChunk(chunk) {
        let content = "";
        let reasoning_content = "";
        let tokens = undefined;
        let finish_reason = undefined;
        // Ollama 流式响应格式
        if (chunk.message?.content) {
            content = chunk.message.content;
        }
        // Ollama 可能返回 thinking (如 llama3.2 支持)
        if (chunk.message?.reasoning) {
            reasoning_content = chunk.message.reasoning;
        }
        // Ollama 的截断原因在 done=true 时通过 done_reason 体现
        if (chunk.done) {
            if (chunk.done_reason === "context_length_exceeded" || chunk.done_reason === "length") {
                finish_reason = "length";
            }
            else {
                finish_reason = "stop";
            }
        }
        // token 统计
        if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }
        return { content, reasoning_content, tokens, finish_reason };
    }
    parseResponse(respJson) {
        let content = "";
        let reasoning_content = "";
        let finish_reason = "";
        // Ollama 响应格式
        if (respJson.message) {
            content = respJson.message.content || "";
            if (respJson.message.reasoning) {
                reasoning_content = respJson.message.reasoning;
            }
        }
        // 检查是否因为 context 满而截断
        if (respJson.done_reason === "context_length_exceeded") {
            finish_reason = "length";
        }
        else if (respJson.done) {
            finish_reason = "stop";
        }
        return {
            content,
            reasoning_content,
            finish_reason,
            tokens: respJson.prompt_eval_count !== undefined
                ? respJson.prompt_eval_count + (respJson.eval_count || 0)
                : respJson.usage?.total_tokens
        };
    }
    async truncatedResponse(body, headers, window, chatManager, messageOutput, data) {
        let continuationCount = 0;
        const maxContinuations = 3;
        let continuationMessages = [...body.messages, { role: "assistant", content: data.output }];
        while (continuationCount < maxContinuations) {
            continuationCount++;
            const continuationBody = { ...body, messages: continuationMessages };
            try {
                const contResp = await fetch(new URL(data.api_url), {
                    method: "POST", headers, body: JSON.stringify(continuationBody)
                });
                const contRespJson = await contResp.json();
                if (contRespJson.error) {
                    console.error("[Continuation Error]", contRespJson.error);
                    break;
                }
                const parsedCont = this.parseResponse(contRespJson);
                data.output += parsedCont.content;
                messageOutput.content = data.output;
                if (!data?.react && data?.llm_conversation_mode) {
                    window?.webContents.send('streamData', {
                        group_id: chatManager.chat.group_id, content: parsedCont.content, end: false, chat: chatManager.chat
                    });
                }
                if (parsedCont.tokens)
                    chatManager.chat.tokens = parsedCont.tokens;
                if (parsedCont.finish_reason !== "length") {
                    logger_1.logger.log(`[Continuation] Completed after ${continuationCount} continuation(s)`);
                    break;
                }
                continuationMessages.push({ role: "assistant", content: parsedCont.content });
            }
            catch (error) {
                console.error("[Continuation Error]", error);
                break;
            }
        }
    }
    getConversationalURL(baseUrl) {
        return `${baseUrl}/api/chat`;
    }
}
exports.OllamaAdapter = OllamaAdapter;
/**
 * OllamaToolCallAdapter - Ollama 的工具调用适配器
 * 使用与 PromptToolCallAdapter 相同的逻辑（Prompt 格式）
 */
class OllamaToolCallAdapter {
    formatTools(toolSchemas) {
        const tool_prompt = {};
        for (const schema of toolSchemas) {
            if (schema.type === "raw_string") {
                tool_prompt[schema.name] = schema.content;
            }
            else {
                let paramsStr = '';
                const exampleParams = {};
                if (schema.parameters && schema.parameters.properties) {
                    for (const [key, prop] of Object.entries(schema.parameters.properties)) {
                        const required = schema.parameters.required?.includes(key) ? "(Required)" : "(Optional)";
                        paramsStr += `- ${key}: ${required} ${prop.description || ''}\n`;
                        if (schema.parameters.required?.includes(key)) {
                            exampleParams[key] = `[${prop.type} value]`;
                        }
                    }
                }
                const usageObj = { thinking: "[Thinking process]", tool: schema.name, params: exampleParams };
                const usageStr = JSON.stringify(usageObj, null, 2).replace(/\n/g, '\\n');
                tool_prompt[schema.name] = `### ${schema.name}\nDescription: ${schema.description}\n\nParameters:\n${paramsStr}\n\nUsage:\n${usageStr}`;
            }
        }
        return tool_prompt;
    }
    getToolInfos(message) {
        let toolInfos = [];
        const contentStr = message.content;
        let reasoningContent = message.reasoning_content || "";
        // 当 reasoningContent 为空时，尝试从 contentStr 中提取 <thinking> 标签
        if (!reasoningContent && typeof contentStr === 'string') {
            const thinkingPatterns = [
                /<thinking>([\s\S]*?)<\/thinking>/gi,
                /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
                /<think>([\s\S]*?)<\/think>/gi,
                /```thinking\n([\s\S]*?)\n```/gi,
                /<thinking_process>([\s\S]*?)<\/thinking_process>/gi,
            ];
            for (const pattern of thinkingPatterns) {
                const match = pattern.exec(contentStr);
                if (match && match[1]) {
                    reasoningContent = match[1].trim();
                    break;
                }
            }
        }
        try {
            let aiResponse = utils.parseJsonContent(contentStr);
            if (!aiResponse) {
                aiResponse = json5_1.default.parse(contentStr);
            }
            const calls = Array.isArray(aiResponse) ? aiResponse : [aiResponse];
            for (let i = 0; i < calls.length; i++) {
                const call = calls[i];
                if (!reasoningContent && !call.content && !call?.tool) {
                    toolInfos.push({
                        reasoning_content: null,
                        content: `\`\`\`text\n${contentStr}\n\`\`\`\n\n**Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                        tool_call_name: null,
                        tool_call_id: `ollama_call_${Date.now()}_${i}`,
                        params: {},
                        error: `Error Message: Tool parsing failed at index ${i}`
                    });
                    continue;
                }
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: call.content || "",
                    tool_call_name: call?.tool || null,
                    tool_call_id: call?.id || `ollama_call_${Date.now()}_${i}`,
                    params: call?.params || {},
                    error: null
                });
            }
        }
        catch (error) {
            const trimmedStr = contentStr.trim();
            if (trimmedStr.startsWith("```json") || trimmedStr.startsWith("{") || trimmedStr.startsWith("[")) {
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: `\`\`\`text\n${contentStr}\n\`\`\`\n\n**Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                    tool_call_name: null,
                    tool_call_id: null,
                    params: {},
                    error: `Error Message: ${error.message}`
                });
            }
            else {
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: contentStr,
                    tool_call_name: null,
                    tool_call_id: null,
                    params: {},
                    error: null
                });
            }
        }
        if (toolInfos.length === 0) {
            toolInfos.push({ reasoning_content: reasoningContent || null, content: contentStr, tool_call_name: null, tool_call_id: null, params: {}, error: null });
        }
        return toolInfos;
    }
    extractText(message) {
        return typeof message.content === 'string' ? message.content : "";
    }
}
exports.OllamaToolCallAdapter = OllamaToolCallAdapter;
