import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult, ToolInfo, AssistantMessage } from '../types';
export declare class AnthropicAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], data: ChatRequestData): any[];
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): any;
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): Promise<void>;
    getConversationalURL(baseUrl: string): string;
}
export declare class AnthropicToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
}
