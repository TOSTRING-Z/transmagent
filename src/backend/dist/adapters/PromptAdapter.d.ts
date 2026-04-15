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
     * 【核心新增】判断字符串是否具有“工具调用”的意图
     * 即使格式损坏（如缺失引号、括号不匹配），只要符合关键特征即可判定
     */
    private isIntendedToolCall;
    /**
     * 统一构造错误状态的 ToolInfo
     */
    private createErrorToolInfo;
}
