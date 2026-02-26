import { ChatRequestData, Message, StreamChunkResult } from '../types';

export interface ILLMAdapter {
    // 过滤和格式化发送给 API 的消息（去除内部字段、处理视觉格式）
    formatMessages(messages: Message[], params: any): any[];
    
    // 组装最终的 Fetch Request Body
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;
    
    // 解析流式 Chunk
    parseStreamChunk(chunk: any): StreamChunkResult;
    
    // 解析非流式 Response
    parseResponse(respJson: any): { content: string, tool_calls?: any[], finish_reason?: string, tokens?: number };
}