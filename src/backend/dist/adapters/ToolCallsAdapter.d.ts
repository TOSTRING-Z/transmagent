import { IToolCallAdapter } from './IAdapter';
import { AssistantMessage, ToolInfo } from '../types';
/**
 * ToolCallsAdapter - 直接从 message.tool_calls 提取工具调用信息
 *
 * 适用于支持 Native Tool Calls 的 API：
 * - OpenAI API (function calling)
 *
 * 特点：
 * - 直接从 message.tool_calls 获取结构化数据
 * - 不需要解析 content 中的 JSON 字符串
 * - 更准确、更快速
 */
export declare class ToolCallsAdapter implements IToolCallAdapter {
    /**
     * 格式化工具描述为 API 支持的格式
     * OpenAI 格式: { type: "function", function: { name, description, parameters } }
     */
    formatTools(toolSchemas: any[]): any;
    /**
     * 从 assistant 消息中提取工具调用信息
     *
     * - OpenAI: message.tool_calls = [{ id, type, function: { name, arguments } }]
     */
    getToolInfos(message: AssistantMessage): ToolInfo[];
    /**
     * 提取消息中的纯文本内容（排除工具调用）
     */
    extractText(message: any): string;
}
