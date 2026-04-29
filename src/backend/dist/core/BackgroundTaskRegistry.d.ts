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
/** 投递给主会话（前端）的消息结构 */
export interface PendingMessage {
    /** 区分消息来源：后台任务结果 vs 代理间通信推送到前端 */
    type: 'task_result' | 'agent_message';
    /** 任务ID（仅当 type 为 task_result 时存在） */
    taskId?: string;
    content: string;
    timestamp: number;
}
export type SessionMessageHandler = (message: PendingMessage) => void;
/**
 * 代理消息监听器：子代理通过此回调接收来自其他代理的消息。
 * @param msg.from    发送方代理名称
 * @param msg.content 消息正文
 * @param msg.timestamp 时间戳
 */
export type AgentMessageListener = (msg: {
    from: string;
    content: string;
    timestamp: number;
}) => void;
/** 代理消息结构（用于队列暂存） */
export interface AgentMessage {
    from: string;
    content: string;
    timestamp: number;
}
export declare class BackgroundTaskRegistry {
    /** 所有后台任务字典（taskId → BgTaskInfo） */
    private static tasks;
    /** sessionId → 待投递消息列表（Handler 注册前的暂存区） */
    private static pending;
    /** sessionId → 即时消息处理器（ToolCall 注册） */
    private static handlers;
    /** taskId → 中断函数（由 runInBackground 注册） */
    private static killFns;
    /** "${sessionId}::${agentName}" → 代理消息监听器 */
    private static agentListeners;
    /** "${sessionId}::${agentName}" → 待投递的代理消息队列（监听器注册前暂存） */
    private static agentMsgQueues;
    static addTaskStart(sessionId: string, taskId: string, toolName: string, command: string): void;
    static markCompleted(taskId: string, resultSummary: string): void;
    static markFailed(taskId: string, errorSummary: string): void;
    /** 注册后台任务的进程中断函数（由 runInBackground 调用） */
    static registerProcess(taskId: string, killFn: (force?: boolean) => void): void;
    /** 注销后台任务的进程中断函数（任务完成后调用） */
    static unregisterProcess(taskId: string): void;
    /**
     * 中断指定后台任务。
     * @returns true 表示成功中断，false 表示任务不存在或已完成
     */
    static interruptTask(taskId: string): boolean;
    /** 返回所有任务列表（按启动时间降序），供前端展示 */
    static getAll(): BgTaskInfo[];
    /** 返回指定会话的任务列表 */
    static getBySession(sessionId: string): BgTaskInfo[];
    /** 清空已完成/失败的任务（保留 running） */
    static clearFinished(): void;
    /**
     * 内部方法：负责将消息投递给主代理（前端），处理即时投递和队列暂存
     */
    private static deliverToMainSession;
    /** 添加后台任务的完成消息，并触发任务结算。
     *  @param skipMarkCompleted - 若为 true，不标记任务完成（用于非瞬态子代理）
     */
    static addMessage(sessionId: string, taskId: string, content: string, skipMarkCompleted?: boolean): void;
    static registerHandler(sessionId: string, handler: SessionMessageHandler): void;
    static unregisterHandler(sessionId: string): void;
    static drainMessages(sessionId: string): PendingMessage[];
    static hasPending(sessionId: string): boolean;
    /**
     * 注册代理消息监听器。
     * 子代理在后台启动时调用，用于接收其他代理发来的消息。
     */
    static registerAgentListener(sessionId: string, agentName: string, listener: AgentMessageListener): void;
    /**
     * 注销代理消息监听器。
     */
    static unregisterAgentListener(sessionId: string, agentName: string): void;
    /**
     * 向指定代理发送消息（代理间通信核心路由）。
     *
     * 路由规则：
     *   - to === "all"  → 注入主代理会话 + 广播所有子代理
     *   - to === "main" → 仅注入主代理会话
     *   - 其他           → 定向投递到指定子代理监听器
     *
     * @returns true 表示消息成功投递到目标，false 表示目标不存在
     */
    static addAgentMessage(sessionId: string, from: string, to: string, content: string): boolean;
    /**
     * 排空指定代理的待处理消息队列。
     */
    static drainAgentMessages(sessionId: string, agentName: string): AgentMessage[];
    static clear(): void;
}
