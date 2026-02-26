import { ILLMAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult } from '../types';

export class PromptAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], params: any, env_message?: any): any[] {
        // Prompt 模型通常只需要最基础的 text，或者由上层将 tool_format 转化为 system prompt
        messages = messages.map((message) => {
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
            messages.push(env_message);
        }
        return messages;
    }

    buildPayload(data: ChatRequestData, messages: any[]): Record<string, any> {
        return {
            model: data.version,
            messages: messages,
            ...data.llm_params
            // 注意：这里不传入 tools 和 tool_choice，避免 API 报错
        };
    }

    parseStreamChunk(chunk: any): StreamChunkResult {
        // 兼容 Ollama 等格式
        if (chunk.message?.content) {
            return { content: chunk.message.content, tokens: chunk.eval_count };
        }
        return { content: chunk.choices?.[0]?.delta?.content || "" };
    }

    parseResponse(respJson: any) {
        return {
            content: respJson.message?.content || respJson.choices?.[0]?.message?.content || "",
            finish_reason: respJson.choices?.[0]?.finish_reason || "stop",
            tokens: respJson.usage?.total_tokens
        };
    }
}