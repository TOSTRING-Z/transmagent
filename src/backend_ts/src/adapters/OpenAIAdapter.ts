import { ILLMAdapter } from './IAdapter';
import { BaseResult, ChatRequestData, Message, MessageContent, OllamaContent, OpenAIContent, StreamChunkResult } from '../types';

export class OpenAIAdapter implements ILLMAdapter {
    public formatMessages(messages: Message[], params: any, env_message?: any): any[] {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const messageCopy: OpenAIContent = {
                role: message.role,
                content: message.content
            }
            if (message.role === "tool" && message.tool_call_id) {
                messageCopy.tool_call_id = message.tool_call_id;
            }
            if (message.role === "assistant" && message.tool_calls) {
                messageCopy.tool_calls = message.tool_calls;
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
                    const textObj = messageCopy.content.find((c: MessageContent) => c.type === "text");
                    const imgObj = messageCopy.content.find((c: MessageContent) => c.type === "image_url");
                    if (imgObj && imgObj.image_url?.url) {
                        const base64Image = imgObj.image_url.url.split(",")[1];
                        const role = messageCopy.role === "tool" ? "user" : messageCopy.role; // tool角色转换为user
                        let ollamaContent: OllamaContent = {
                            role: role,
                            content: textObj?.text || "",
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

    public buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any> {
        const body: Record<string, any> = {
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

    public parseStreamChunk(chunk: any): StreamChunkResult {
        let content = "";
        let reasoning_content = "";
        let tool_calls: any[] | undefined = undefined;
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
                if (delta.tool_calls) {
                    tool_calls = delta.tool_calls;
                }
            }
        }

        // 兼容不同的 token 统计返回格式
        if (chunk.usage?.total_tokens) {
            tokens = chunk.usage.total_tokens;
        } else if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }

        return { content, reasoning_content, tool_calls, tokens };
    }

    public parseResponse(respJson: any): any {
        let content = "";
        let tool_calls: any[] | undefined = undefined;
        let finish_reason = "";

        if (respJson.message) {
            content = respJson.message.content;
        } else {
            const choice = respJson.choices?.[0];
            content = choice?.message?.content || "";
            tool_calls = choice?.message?.tool_calls;
            finish_reason = choice?.finish_reason || "";
        }

        return {
            content,
            tool_calls,
            finish_reason,
            tokens: respJson.usage?.total_tokens
        };
    }

    public formatOutput(message: Message): BaseResult {
        return {
            tool_format: "openai",
            message: message
        };
    }
}