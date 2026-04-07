import { LLMService } from './LLMService';
import { Plugins } from './Plugins';
import { ToolInfo } from '../types';
import { Utils } from './Utils';
import { ToolCall } from './ToolCall';
/**
 * LLMAssistant - LLM对话辅助功能类
 * 统一管理压缩对话、设置聊天名称、工具审计等LLM交互功能
 */
export declare class LLMAssistant {
    private llmService;
    private plugins;
    private utils;
    constructor(llmService: LLMService, plugins: (Plugins | null) | undefined, utils: Utils);
    setLLMService(llmService: LLMService): void;
    setPlugins(plugins: Plugins): void;
    /**
     * 创建临时 ReActAgent
     * 统一处理配置拷贝与消息深拷贝，避免对主对话上下文造成意外污染
     * @param modifyMessages 可选回调，用于对拷贝的消息列表进行修改
     */
    private createTempAgent;
    compressionGroupMessage({ group_id }: {
        group_id: string;
    }): Promise<string | null>;
    setChatName(_data?: any): Promise<void>;
    isToolRequireAudit(toolName: string, toolCall: ToolCall): boolean;
    auditToolCall(toolInfo: ToolInfo, data: Record<string, any>, toolCall: ToolCall): Promise<string | null>;
    checkConsoleOutput(consoleOutput: string, executionTimeMs?: number): Promise<{
        shouldInterrupt: boolean;
        reason: string | null;
    }>;
    kvCacheSummary(): Promise<void>;
    /**
     * 整理 memory.md 文件
     * 在 callReAct 结束后自动调用，去除重复、合并同类、整理格式
     */
    organizeMemory(): Promise<void>;
}
export default LLMAssistant;
