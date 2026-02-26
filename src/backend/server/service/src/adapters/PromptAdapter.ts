import { ILLMAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult } from '../types';

export class PromptAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], params: any): any[] {
        // Prompt 模型通常只需要最基础的 text，或者由上层将 tool_format 转化为 system prompt
        return messages.map(msg => ({
            role: msg.role,
            content: Array.isArray(msg.content) ? JSON.stringify(msg.content) : msg.content
        }));
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