import { ChatRequestData, Message, StreamChunkResult } from '../types';
export interface ILLMAdapter {
    formatMessages(messages: Message[], params: Record<string, any>, env_message?: any): any[];
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): {
        content: string;
        tool_calls?: any[];
        finish_reason?: string;
        tokens?: number;
    };
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): any;
}
export interface IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfo(message: Message): any;
    extractText(message: any): string;
}
