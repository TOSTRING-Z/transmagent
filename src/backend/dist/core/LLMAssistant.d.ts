import { LLMService } from './LLMService';
import { Plugins } from './Plugins';
import { Message, ToolInfo } from '../types';
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
    /**
     * 创建临时 LLMBase
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
     * 在 callReAct 结束后自动调用，去除重复、合并同类、整理格式、清洗临时会话状态
     */
    organizeMemory(): Promise<void>;
    /**
     * 检测当前 messages 中最后一条 user 消息是否为心跳消息。
     *
     * @param messages 当前对话消息列表
     * @returns true 表示检测到心跳关键字
     */
    detectHeartbeat(query: unknown): boolean;
    /**
     * 心跳审查结果裁决（在 LLM 回复之后调用）。
     *
     * 委托 LLM 审查者判断是否有到期 recurring 任务：
     * - 若 toolInfos 为空（LLM 输出 [STANDBY] 且无工具调用）→ 阻断：
     *   移除心跳 user 消息及 [STANDBY] 回复，保持上下文清洁。
     * - 若 toolInfos 非空（LLM 决定执行工具）→ 放行。
     *
     * @param toolInfos     当前轮次解析出的工具调用列表
     * @param messages               chatManager 的消息列表（会被原地修改）
     * @param hadToolCallsInSession  本轮心跳会话中是否曾有任何工具调用
     * @returns true 表示心跳被阻断（调用方应退出本轮），false 表示放行
     */
    resolveHeartbeatReview(toolInfos: ToolInfo[], messages: Message[], hadToolCallsInSession: boolean): boolean;
    /**
     * 从 messages 中移除最后一条心跳 user 消息及其之后的所有内容。
     */
    private removeHeartbeatMessages;
}
export default LLMAssistant;
