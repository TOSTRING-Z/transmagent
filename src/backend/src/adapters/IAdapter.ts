import { ChatRequestData, Message as AssistantMessage, StreamChunkResult, ToolInfo } from '../types';

export interface ILLMAdapter {
    // 过滤和格式化发送给 API 的消息（去除内部字段、处理视觉格式）
    formatMessages(messages: AssistantMessage[], data: ChatRequestData): any[];
    
    // 组装最终的 Fetch Request Body
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;

    // 构建请求头（如 API Key、特殊模型参数等）
    buildHeaders(data: ChatRequestData): Record<string, string>;
    
    // 解析流式 Chunk
    parseStreamChunk(chunk: any): StreamChunkResult;
    
    // 解析非流式 Response
    parseResponse(respJson: any): { content: string, reasoning_content?: string, thinking_signature?: string, tool_calls?: any[], finish_reason?: string, tokens?: number };

    // 输出截断与续传
    truncatedResponse(body, headers, window, chatManager, messageOutput, data: ChatRequestData): any;

    // 获取Conversational API_URL
    getConversationalURL(baseUrl: string): string;
}

export interface IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
}