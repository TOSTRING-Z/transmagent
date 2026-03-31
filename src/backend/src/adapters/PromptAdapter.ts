import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, MessageContent, OllamaContent, OpenAIContent, StreamChunkResult, ImageContent, TextContent, ToolInfo } from '../types';
import JSON5 from 'json5';
import { utils } from '../utils/globals';
import { logger } from '../utils/logger';

export class PromptAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], data: ChatRequestData): any[] {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const role = message.role === "tool" ? "user" : message.role; // tool角色转换为user
            const messageCopy: OpenAIContent = {
                role: role,
                content: message.content
            }

            // 2. 视觉模型参数处理
            if (!data.params?.vision) {
                // 非视觉模型：如果是数组内容，提取出纯文本
                if (Array.isArray(messageCopy.content)) {
                    messageCopy.content = messageCopy.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n');
                }
            } else {
                // 视觉模型：根据支持的媒体类型进行过滤
                if (Array.isArray(messageCopy.content)) {
                    messageCopy.content = messageCopy.content.filter((c: any) => {
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

            // 3. 针对 Ollama 等兼容 OpenAI 格式的模型做特殊适配
            if (data.params?.ollama && Array.isArray(messageCopy.content)) {
                try {
                    const textObj = messageCopy.content.find(
                        (c: MessageContent): c is TextContent => c.type === "text"
                    );
                    const imgObj = messageCopy.content.find(
                        (c: MessageContent): c is ImageContent => c.type === "image_url"
                    );
                    if (textObj && imgObj) {
                        const base64Image = imgObj.image_url.url.split(",")[1];
                        const role = messageCopy.role === "tool" ? "user" : messageCopy.role; // tool角色转换为user
                        let ollamaContent: OllamaContent = {
                            role: role,
                            content: textObj.text || "",
                            images: [base64Image]
                        };
                        return ollamaContent;
                    }
                } catch (e: any) {
                    console.error("Ollama format error", e);
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

    public buildHeaders(data: ChatRequestData): Record<string, string> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (data?.api_key) headers["Authorization"] = `Bearer ${data.api_key}`;
        return headers;
    }

    public parseStreamChunk(chunk: any): StreamChunkResult {
        let content = "";
        let reasoning_content = "";
        let tokens: number | undefined = undefined;

        if (chunk.message?.content) {
            content = chunk.message.content;
        } else {
            const delta = chunk.choices?.[0]?.delta;
            if (delta) {
                if (delta.reasoning_content) {
                    reasoning_content = delta.reasoning_content;
                } else if (delta.content) {
                    content = delta.content;
                }
            }
        }

        // 兼容不同的 token 统计返回格式
        if (chunk.usage?.total_tokens) {
            tokens = chunk.usage.total_tokens;
        } else if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }

        return { content, reasoning_content, tokens };
    }

    public parseResponse(respJson: any): any {
        let content = "";
        let reasoning_content = "";
        let finish_reason = "";

        if (respJson.message) {
            content = respJson.message.content;
            if (respJson.message.reasoning_content) {
                reasoning_content = respJson.message.reasoning_content;
            }
        } else {
            const choice = respJson.choices?.[0];
            content = choice?.message?.content || "";
            finish_reason = choice?.finish_reason || "";
        }

        return {
            content,
            reasoning_content,
            finish_reason,
            tokens: respJson.usage?.total_tokens
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
                messageOutput.content = data.output; // 全量积累

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
}

export class PromptToolCallAdapter implements IToolCallAdapter {
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

                tool_prompt[schema.name] = `### ${schema.name}\nDescription: ${schema.description}\n\nParameters:\n${paramsStr}\nUsage:\n${usageStr}`;
            }
        }
        return tool_prompt;
    }

    public getToolInfos(message: Message): ToolInfo[] {
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
            // 尝试解析文本中的 JSON
            let aiResponse: any = utils.parseJsonContent(contentStr);
            if (!aiResponse) {
                aiResponse = JSON5.parse(contentStr);
            }

            // 兼容模型输出的是单工具对象 {...} 还是多工具数组 [...]
            const calls = Array.isArray(aiResponse) ? aiResponse : [aiResponse];

            for (let i = 0; i < calls.length; i++) {
                const call = calls[i];

                // 容错：如果解析出的对象既没有 content 也没有 tool
                if (!reasoningContent && !call.content && !call?.tool) {
                    toolInfos.push({
                        reasoning_content: null,
                        content: `\`\`\`text\n${contentStr}\n\`\`\`\n\n**Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                        tool: null,
                        // 生成一个伪id，便于追踪
                        id: `prompt_call_${Date.now()}_${i}`,
                        params: {},
                        error: `Error Message: Tool parsing failed at index ${i}`
                    });
                    continue;
                }

                // 正常解析推入数组
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: call.content || "",
                    tool: call?.tool || null,
                    // 原生Prompt没有ID，这里为并行调用生成一个伪唯一ID，或者使用模型自己生成的ID
                    id: call?.id || `prompt_call_${Date.now()}_${i}`,
                    params: call?.params || {},
                    error: null
                });
            }

        } catch (error: any) {
            // 解析失败时的降级处理
            const trimmedStr = contentStr.trim();
            if (trimmedStr.startsWith("```json") || trimmedStr.startsWith("{") || trimmedStr.startsWith("[")) {
                // 模型试图进行 JSON 输出但格式损坏
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: `\`\`\`text\n${contentStr}\n\`\`\`\n\n**Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                    tool: null,
                    id: null,
                    params: {},
                    error: `Error Message: ${error.message}`
                });
            } else {
                // 纯文本思考，不含工具调用
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: contentStr,
                    tool: null,
                    id: null,
                    params: {},
                    error: null
                });
            }
        }

        // 兜底：如果数组无论何种原因变为空，塞入一条纯文本记录
        if (toolInfos.length === 0) {
            toolInfos.push({ reasoning_content: reasoningContent || null, content: contentStr, tool: null, id: null, params: {}, error: null });
        }

        return toolInfos;
    }

    extractText(message: any): string {
        return typeof message.content === 'string' ? message.content : "";
    }
}