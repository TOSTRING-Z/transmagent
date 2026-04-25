import { ChatRequestData, Message as AssistantMessage, StreamChunkResult, ToolInfo } from '../types';
export interface ILLMAdapter {
    formatMessages(messages: AssistantMessage[], data: ChatRequestData): any[];
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): {
        content: string;
        reasoning_content?: string;
        thinking_signature?: string;
        tool_calls?: any[];
        finish_reason?: string;
        tokens?: number;
    };
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): any;
    getConversationalURL(baseUrl: string): string;
}
export interface IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
}
