import { IToolCallAdapter } from './IAdapter';
import { AssistantMessage, ToolInfo } from '../types';
export declare class PromptToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
}
