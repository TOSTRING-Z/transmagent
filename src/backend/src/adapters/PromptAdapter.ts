import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, MessageContent, OllamaContent, OpenAIContent, StreamChunkResult, ImageContent, TextContent, ToolInfo } from '../types';
import JSON5 from 'json5';

export class PromptAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], params: any, env_message?: Message): any[] {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const role = message.role === "tool" ? "user" : message.role; // tool角色转换为user
            const messageCopy: OpenAIContent = {
                role: role,
                content: message.content
            }

            // 2. 视觉模型参数处理
            if (!params?.vision) {
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
                } catch (e) {
                    console.error("Ollama format error", e);
                }
            }

            return messageCopy;
        });

        if (env_message) {
            formattedMessages.push(env_message);
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
        let finish_reason = "";

        if (respJson.message) {
            content = respJson.message.content;
        } else {
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
    public getToolInfo(message: Message): ToolInfo {
        let aiRespnse: any = null;
        let toolInfo: ToolInfo | null = null;
        try {
            aiRespnse = JSON5.parse(message.content as string);
            toolInfo = { thinking: aiRespnse.thinking, tool: aiRespnse?.tool, id: null, params: aiRespnse?.params || {}, error: null };
        } catch (error: any) {
            // 解析失败时的兜底错误处理
            let observation = `Function calling is not a pure JSON text, or there is a problem with the JSON format: ${error.message}`;
            toolInfo = { thinking: null, tool: null, id: null, params: {}, error: observation };
        }
        return toolInfo;
    }
    extractText(message: any): string {
        return typeof message.content === 'string' ? message.content : "";
    }
}