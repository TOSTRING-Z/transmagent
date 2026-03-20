import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult, ToolInfo } from '../types';
export declare class AnthropicAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], params: any, env_message?: any): any[];
    buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): any;
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): Promise<void>;
}
export declare class AnthropicToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfo(message: Message): ToolInfo;
    extractText(message: any): string;
}
