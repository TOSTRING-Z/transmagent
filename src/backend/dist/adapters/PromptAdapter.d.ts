import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult, ToolInfo } from '../types';
export declare class PromptAdapter implements ILLMAdapter {
    formatMessages(messages: Message[], params: any, env_message?: Message): any[];
    buildPayload(data: ChatRequestData, messages: Message[]): Record<string, any>;
    buildHeaders(data: ChatRequestData): Record<string, string>;
    parseStreamChunk(chunk: any): StreamChunkResult;
    parseResponse(respJson: any): any;
    truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData): Promise<void>;
}
export declare class PromptToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfo(message: Message): ToolInfo;
    extractText(message: any): string;
}
