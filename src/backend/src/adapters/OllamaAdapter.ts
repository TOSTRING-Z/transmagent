import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, MessageContent, OllamaContent, StreamChunkResult, ImageContent, TextContent, ToolInfo, ToolCall, AssistantMessage } from '../types';
import JSON5 from 'json5';
import { utils } from '../utils/globals';
import { logger } from '../utils/logger';

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
export class OllamaAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], data: ChatRequestData): any[] {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const role = message.role === "tool" ? "user" : message.role; // tool角色转换为user
            let messageCopy: OllamaContent = {
                role: role,
                content: ""
            };

            // 2. 视觉模型参数处理 - Ollama 视觉模型如 llama3.2-vision
            if (data.params?.vision) {
                if (Array.isArray(message.content)) {
                    const textObj = message.content.find(
                        (c: MessageContent): c is TextContent => c.type === "text"
                    );
                    const imgObj = message.content.find(
                        (c: MessageContent): c is ImageContent => c.type === "image_url"
                    );

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
            } else {
                // 非视觉模型：如果是数组内容，提取出纯文本
                if (Array.isArray(message.content)) {
                    messageCopy.content = message.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n');
                } else {
                    messageCopy.content = message.content as string;
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

    buildPayload(data: ChatRequestData, messages: Message[]): Record<string, any> {
        // 构建 Ollama 特定的请求体
        const payload: Record<string, any> = {
            model: data.version,
            messages: messages.map(msg => {
                if (msg.role === "tool") {
                    return {
                        role: "user",
                        content: msg.content
                    }
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

    public buildHeaders(data: ChatRequestData): Record<string, string> {
        return { "Content-Type": "application/json" };
    }

    public parseStreamChunk(chunk: any): StreamChunkResult {
        let content = "";
        let reasoning_content = "";
        let tokens: number | undefined = undefined;

        // Ollama 流式响应格式
        if (chunk.message?.content) {
            content = chunk.message.content;
        }

        // Ollama 可能返回 thinking (如 llama3.2 支持)
        if (chunk.message?.reasoning) {
            reasoning_content = chunk.message.reasoning;
        }

        // token 统计
        if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }

        return { content, reasoning_content, tokens };
    }

    public parseResponse(respJson: any): any {
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
        } else if (respJson.done) {
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

    public async truncatedResponse(body, headers, window, chatManager, messageOutput, data: ChatRequestData) {
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
                const contRespJson = await contResp.json() as any;

                if (contRespJson.error) {
                    console.error("[Continuation Error]", contRespJson.error);
                    break;
                }

                const parsedCont = this.parseResponse(contRespJson);
                data.output += parsedCont.content;
                messageOutput.content = data.output;

                if (!data?.react && !data?.return_response) {
                    window?.webContents.send('streamData', {
                        group_id: chatManager.chat.group_id, content: parsedCont.content, end: false, chat: chatManager.chat
                    });
                }

                if (parsedCont.tokens) chatManager.chat.tokens = parsedCont.tokens;

                if (parsedCont.finish_reason !== "length") {
                    logger.log(`[Continuation] Completed after ${continuationCount} continuation(s)`);
                    break;
                }

                continuationMessages.push({ role: "assistant", content: parsedCont.content });

            } catch (error: any) {
                console.error("[Continuation Error]", error);
                break;
            }
        }
    }

    public getConversationalURL(baseUrl: string): string {
        return `${baseUrl}/api/chat`;
    }
}

/**
 * OllamaToolCallAdapter - Ollama 的工具调用适配器
 * 使用与 PromptToolCallAdapter 相同的逻辑（Prompt 格式）
 */
export class OllamaToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any {
        const tool_prompt: Record<string, string> = {};

        for (const schema of toolSchemas) {
            if (schema.type === "raw_string") {
                tool_prompt[schema.name] = schema.content;
            } else {
                let paramsStr = '';
                const exampleParams: Record<string, string> = {};

                if (schema.parameters && schema.parameters.properties) {
                    for (const [key, prop] of Object.entries<any>(schema.parameters.properties)) {
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

    public getToolInfos(message: AssistantMessage): ToolInfo[] {
        let toolInfos: ToolInfo[] = [];
        const contentStr = message.content as string;
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
            let aiResponse: any = utils.parseJsonContent(contentStr);
            if (!aiResponse) {
                aiResponse = JSON5.parse(contentStr);
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

        } catch (error: any) {
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
            } else {
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

    extractText(message: any): string {
        return typeof message.content === 'string' ? message.content : "";
    }
}
