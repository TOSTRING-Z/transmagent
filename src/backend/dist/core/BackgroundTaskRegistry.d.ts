/**
 * BackgroundTaskRegistry.ts
 *
 * 【职责】后台任务结果的消息注册表 + 生命周期追踪（跨会话共享静态存储）。
 *
 * 工作流：
 *   1. cli_execute / python_execute 后台任务启动时调用 addTaskStart() 注册。
 *   2. 任务完成时调用 addMessage() → 自动将任务标记为 completed。
 *   3. 前端实时展示 running/completed/failed 状态列表。
 */
export type BgTaskStatus = 'running' | 'completed' | 'failed';
export interface BgTaskInfo {
    taskId: string;
    sessionId: string;
    toolName: string;
    /** 任务启动的命令摘要（截断后的前 80 字符） */
    commandSummary: string;
    status: BgTaskStatus;
    startTime: number;
    endTime?: number;
    /** 完成时的输出摘要（截断后的前 200 字符） */
    resultSummary?: string;
}
export interface PendingMessage {
    taskId: string;
    content: string;
    timestamp: number;
}
export type SessionMessageHandler = (message: PendingMessage) => void;
export declare class BackgroundTaskRegistry {
    /** 所有后台任务字典（taskId → BgTaskInfo） */
    private static tasks;
    /** sessionId → 待投递消息列表（Handler 注册前的暂存区） */
    private static pending;
    /** sessionId → 即时消息处理器（ToolCall 注册） */
    private static handlers;
    static addTaskStart(sessionId: string, taskId: string, toolName: string, command: string): void;
    static markCompleted(taskId: string, resultSummary: string): void;
    static markFailed(taskId: string, errorSummary: string): void;
    /** 返回所有任务列表（按启动时间降序），供前端展示 */
    static getAll(): BgTaskInfo[];
    /** 返回指定会话的任务列表 */
    static getBySession(sessionId: string): BgTaskInfo[];
    /** 清空已完成/失败的任务（保留 running） */
    static clearFinished(): void;
    static addMessage(sessionId: string, taskId: string, content: string): void;
    static registerHandler(sessionId: string, handler: SessionMessageHandler): void;
    static unregisterHandler(sessionId: string): void;
    static drainMessages(sessionId: string): PendingMessage[];
    static hasPending(sessionId: string): boolean;
    static clear(): void;
}
