"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptToolCallAdapter = exports.PromptAdapter = void 0;
const json5_1 = __importDefault(require("json5"));
const globals_1 = require("../utils/globals");
const logger_1 = require("../utils/logger");
class PromptAdapter {
    formatMessages(messages, params, env_message) {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const role = message.role === "tool" ? "user" : message.role; // tool角色转换为user
            const messageCopy = {
                role: role,
                content: message.content
            };
            // 2. 视觉模型参数处理
            if (!params?.vision) {
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
                                return params.vision.includes("image");
                            case "video_url":
                                return params.vision.includes("video");
                            case "text":
                                return true;
                            default:
                                return false;
                        }
                    });
                }
            }
            // 3. 针对 Ollama 等兼容 OpenAI 格式的模型做特殊适配
            if (params?.ollama && Array.isArray(messageCopy.content)) {
                try {
                    const textObj = messageCopy.content.find((c) => c.type === "text");
                    const imgObj = messageCopy.content.find((c) => c.type === "image_url");
                    if (textObj && imgObj) {
                        const base64Image = imgObj.image_url.url.split(",")[1];
                        const role = messageCopy.role === "tool" ? "user" : messageCopy.role; // tool角色转换为user
                        let ollamaContent = {
                            role: role,
                            content: textObj.text || "",
                            images: [base64Image]
                        };
                        return ollamaContent;
                    }
                }
                catch (e) {
                    console.error("Ollama format error", e);
                }
            }
            return messageCopy;
        });
        if (env_message) {
            formattedMessages[formattedMessages.length - 1].content += `\n${env_message.content}`;
        }
        return formattedMessages;
    }
    buildPayload(data, messages) {
        return {
            model: data.version,
            messages: messages.map(msg => {
                if (msg.role === "tool") {
                    msg.role = "user";
                }
                return msg;
            }),
            ...data.llm_params
            // 注意：这里不传入 tools 和 tool_choice，避免 API 报错
        };
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
        let tokens = undefined;
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
            }
        }
        // 兼容不同的 token 统计返回格式
        if (chunk.usage?.total_tokens) {
            tokens = chunk.usage.total_tokens;
        }
        else if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }
        return { content, reasoning_content, tokens };
    }
    parseResponse(respJson) {
        let content = "";
        let finish_reason = "";
        if (respJson.message) {
            content = respJson.message.content;
        }
        else {
            const choice = respJson.choices?.[0];
            content = choice?.message?.content || "";
            finish_reason = choice?.finish_reason || "";
        }
        return {
            content,
            finish_reason,
            tokens: respJson.usage?.total_tokens
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
                messageOutput.content = data.output; // 全量积累
                if (!data?.react && !data?.return_response) {
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
}
exports.PromptAdapter = PromptAdapter;
class PromptToolCallAdapter {
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
                tool_prompt[schema.name] = `### ${schema.name}\nDescription: ${schema.description}\n\nParameters:\n${paramsStr}\nUsage:\n${usageStr}`;
            }
        }
        return tool_prompt;
    }
    getToolInfo(message) {
        let aiRespnse = null;
        let toolInfo;
        try {
            aiRespnse = globals_1.utils.parseJsonContent(message.content);
            if (!aiRespnse) {
                aiRespnse = json5_1.default.parse(message.content);
            }
            toolInfo = { thinking: aiRespnse.thinking, tool: aiRespnse?.tool, id: null, params: aiRespnse?.params || {}, error: null };
        }
        catch (error) {
            if (message.content.startsWith("```json") || message.content.startsWith("{")) {
                toolInfo = {
                    thinking: `\`\`\`text
                    ${message.content}
                    \`\`\`
                    
                    **Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                    tool: null,
                    id: null,
                    params: {},
                    error: `Error Message: ${error.message}`
                };
            }
            else {
                toolInfo = {
                    thinking: message.content,
                    tool: null,
                    id: null,
                    params: {},
                    error: null
                };
            }
        }
        return toolInfo;
    }
    extractText(message) {
        return typeof message.content === 'string' ? message.content : "";
    }
}
exports.PromptToolCallAdapter = PromptToolCallAdapter;
//# sourceMappingURL=PromptAdapter.js.map