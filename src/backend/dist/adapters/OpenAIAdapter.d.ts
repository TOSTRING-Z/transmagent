import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { AssistantMessage, ChatRequestData, Message, StreamChunkResult, ToolInfo } from '../types';
export declare class OpenAIAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], data: ChatRequestData): any[];
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): any;
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): Promise<void>;
    getConversationalURL(baseUrl: string): string;
}
export declare class OpenAIToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
}
