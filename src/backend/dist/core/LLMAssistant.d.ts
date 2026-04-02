import { LLMService } from './LLMService';
import { Plugins } from './Plugins';
import { ToolInfo } from '../types';
/**
 * LLMAssistant - LLM对话辅助功能类
 * 统一管理压缩对话、设置聊天名称、工具审计等LLM交互功能
 */
export declare class LLMAssistant {
    private llm_service;
    private plugins;
    constructor(llm_service: LLMService, plugins?: Plugins | null);
    /**
     * 设置关联的 LLMService 实例
     */
    setLLMService(llm_service: LLMService): void;
    /**
     * 设置关联的 Plugins 实例
     */
    setPlugins(plugins: Plugins): void;
    /**
     * 压缩指定群组的消息
     * @param group_id 要压缩的消息群组ID
     * @returns 压缩后的内容，如果失败返回null
     */
    compressionGroupMessage({ group_id }: {
        group_id: string;
    }): Promise<string | null>;
    /**
     * 根据对话内容生成聊天名称
     * @param _data 可选参数，包含language, model, version等配置
     */
    setChatName(_data?: any): Promise<void>;
    /**
     * 检查工具是否需要审计
     * @param toolName 工具名称
     */
    isToolRequireAudit(toolName: string): boolean;
    /**
     * 获取工具配置
     * @param toolName 工具名称
     */
    getToolConfig(toolName: string): any;
    /**
     * AI 审查者逻辑 (LLM-as-a-Judge)
     * 对敏感工具调用进行数据完整性审查
     * @param toolInfo 工具信息
     * @param assistantMessage 助手消息
     * @param data 额外数据
     * @returns 审查结果，如果通过返回null，如果拦截返回错误信息
     */
    auditToolCall(toolInfo: ToolInfo, data: Record<string, any>): Promise<string | null>;
    /**
     * 检查控制台输出是否需要中断指令
     * @param consoleOutput 控制台输出内容
     * @param executionTimeMs 执行时间（毫秒）
     * @returns 检查结果，包含是否中断以及中断理由
     */
    checkConsoleOutput(consoleOutput: string, executionTimeMs?: number): Promise<{
        shouldInterrupt: boolean;
        reason: string | null;
    }>;
}
export default LLMAssistant;
