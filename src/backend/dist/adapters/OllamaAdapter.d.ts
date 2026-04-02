import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult, ToolInfo, AssistantMessage } from '../types';
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
export declare class OllamaAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], data: ChatRequestData): any[];
    buildPayload(data: ChatRequestData, messages: Message[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): any;
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): Promise<void>;
    getConversationalURL(baseUrl: string): string;
}
/**
 * OllamaToolCallAdapter - Ollama 的工具调用适配器
 * 使用与 PromptToolCallAdapter 相同的逻辑（Prompt 格式）
 */
export declare class OllamaToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
}
