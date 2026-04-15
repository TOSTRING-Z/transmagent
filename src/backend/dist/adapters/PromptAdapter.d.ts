import { IToolCallAdapter } from './IAdapter';
import { AssistantMessage, ToolInfo } from '../types';
export declare class PromptToolCallAdapter implements IToolCallAdapter {
    private static readonly THINKING_PATTERNS;
    formatTools(toolSchemas: any[]): any;
    getToolInfos(message: AssistantMessage): ToolInfo[];
    extractText(message: any): string;
    /**
     * 提取思考过程内容
     */
    private extractReasoning;
    /**
     * 统一构造错误状态的 ToolInfo
     */
    private createErrorToolInfo;
}
