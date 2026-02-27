import { ILLMAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult } from '../types';

export class PromptAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], params: any, env_message?: any): any[] {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const messageCopy = { ...message };
            delete messageCopy.id;
            delete messageCopy.context_id;
            delete messageCopy.show;
            delete messageCopy.react;
            delete messageCopy.del;
            delete messageCopy.thumb;

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
                    const textObj = messageCopy.content.find((c: any) => c.type === "text");
                    const imgObj = messageCopy.content.find((c: any) => c.type === "image_url");
                    if (imgObj && imgObj.image_url?.url) {
                        const base64Image = imgObj.image_url.url.split(",")[1];
                        return {
                            role: messageCopy.role,
                            content: textObj?.text || "",
                            images: [base64Image]
                        };
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

    buildPayload(data: ChatRequestData, messages: any[]): Record<string, any> {
        return {
            model: data.version,
            messages: messages,
            ...data.llm_params
            // 注意：这里不传入 tools 和 tool_choice，避免 API 报错
        };
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