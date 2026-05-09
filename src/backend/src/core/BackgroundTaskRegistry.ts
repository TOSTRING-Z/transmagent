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

import { logger } from '../utils/logger';

export type BgTaskStatus = 'running' | 'completed' | 'failed' | 'idle';

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
    /** 完整输出文件路径 */
    outputFilePath?: string;
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

/** 
 * 主会话消息处理器。返回 false 表示 agent 活跃中，消息应入队由 middleware drain；
 * 返回 void/true 表示已直接处理。
 */
export type SessionMessageHandler = (message: PendingMessage) => boolean | void;

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

export class BackgroundTaskRegistry {
    /** 所有后台任务字典（taskId → BgTaskInfo） */
    private static tasks: Map<string, BgTaskInfo> = new Map();

    /** sessionId → 待投递消息列表（Handler 注册前的暂存区） */
    private static pending: Map<string, PendingMessage[]> = new Map();

    /** sessionId → 即时消息处理器（ToolCall 注册） */
    private static handlers: Map<string, SessionMessageHandler> = new Map();

    /** taskId → 中断函数（由 runInBackground 注册） */
    private static killFns: Map<string, (force?: boolean) => void> = new Map();

    /** "${sessionId}::${agentName}" → 代理消息监听器 */
    private static agentListeners: Map<string, AgentMessageListener> = new Map();

    /** "${sessionId}::${agentName}" → 待投递的代理消息队列（监听器注册前暂存） */
    private static agentMsgQueues: Map<string, AgentMessage[]> = new Map();

    // ─── 生命周期追踪 ──────────────────────────────────────────────────────

    static addTaskStart(
        sessionId: string,
        taskId: string,
        toolName: string,
        command: string,
    ): void {
        this.tasks.set(taskId, {
            taskId,
            sessionId,
            toolName,
            commandSummary: command.replace(/\n/g, ' ').substring(0, 80),
            status: 'running',
            startTime: Date.now(),
        });
        logger.log(
            `[BackgroundTaskRegistry] Task "${taskId}" (${toolName}) started for session "${sessionId}"`
        );
    }

    static markCompleted(taskId: string, resultSummary: string): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'completed';
            task.endTime = Date.now();
            task.resultSummary = resultSummary.replace(/\n/g, ' ').substring(0, 200);
            logger.log(`[BackgroundTaskRegistry] Task "${taskId}" completed`);
        }
    }

    static markFailed(taskId: string, errorSummary: string): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'failed';
            task.endTime = Date.now();
            task.resultSummary = errorSummary.replace(/\n/g, ' ').substring(0, 200);
            logger.log(`[BackgroundTaskRegistry] Task "${taskId}" failed`);
        }
    }

    /** 注册后台任务的进程中断函数（由 runInBackground 调用） */
    static registerProcess(taskId: string, killFn: (force?: boolean) => void): void {
        this.killFns.set(taskId, killFn);
        logger.log(`[BackgroundTaskRegistry] Kill function registered for task "${taskId}"`);
    }

    /** 注销后台任务的进程中断函数（任务完成后调用） */
    static unregisterProcess(taskId: string): void {
        this.killFns.delete(taskId);
    }

    /**
     * 中断指定后台任务。
     * @returns true 表示成功中断，false 表示任务不存在或已完成
     */
    static interruptTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) {
            logger.warn(`[BackgroundTaskRegistry] interruptTask: task "${taskId}" not found`);
            return false;
        }
        if (task.status !== 'running') {
            logger.warn(`[BackgroundTaskRegistry] interruptTask: task "${taskId}" is already ${task.status}`);
            return false;
        }

        const killFn = this.killFns.get(taskId);
        if (killFn) {
            killFn(true); // force kill (SIGKILL)
            this.killFns.delete(taskId);
        }

        this.markFailed(taskId, 'Interrupted by user');
        logger.log(`[BackgroundTaskRegistry] Task "${taskId}" interrupted`);
        return true;
    }

    /** 返回所有任务列表（按启动时间降序），供前端展示 */
    static getAll(): BgTaskInfo[] {
        return Array.from(this.tasks.values()).sort(
            (a, b) => b.startTime - a.startTime
        );
    }

    /** 返回指定会话的任务列表 */
    static getBySession(sessionId: string): BgTaskInfo[] {
        return this.getAll().filter((t) => t.sessionId === sessionId);
    }

    /** 设置任务的输出文件路径 */
    static setTaskOutputFile(taskId: string, outputFilePath: string): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.outputFilePath = outputFilePath;
        }
    }

    /** 获取任务详情 */
    static getTaskDetails(taskId: string): BgTaskInfo | undefined {
        return this.tasks.get(taskId);
    }

    /** 读取指定任务的完整输出（最后N行） */
    static async getTaskOutput(taskId: string, maxLines: number = 200): Promise<string> {
        const task = this.tasks.get(taskId);
        if (!task || !task.outputFilePath) {
            return '[Output file not available]';
        }
        try {
            const fs = await import('fs');
            if (!fs.existsSync(task.outputFilePath)) {
                return '[Output file not yet created or already removed]';
            }
            const content = fs.readFileSync(task.outputFilePath, 'utf-8');
            if (!content || content.trim().length === 0) {
                return task.status === 'running'
                    ? '[Task is running, no output yet...]'
                    : '[No output captured]';
            }
            const lines = content.split(/\r?\n/);
            if (lines.length > maxLines) {
                return lines.slice(-maxLines).join('\n');
            }
            return content;
        } catch (err: any) {
            return `[Failed to read output: ${err.message}]`;
        }
    }

    /** 清空已完成/失败的任务（保留 running） */
    static clearFinished(): void {
        for (const [id, task] of this.tasks) {
            if (task.status !== 'running') {
                this.tasks.delete(id);
            }
        }
    }

    // ─── 主会话消息投递核心逻辑 ───────────────────────────────────────────────────

    /** 
     * 内部方法：负责将消息投递给主代理（前端），处理即时投递和队列暂存 
     */
    private static deliverToMainSession(sessionId: string, msg: PendingMessage): void {
        const handler = this.handlers.get(sessionId);
        if (handler) {
            const accepted = handler(msg);
            // handler 返回 false 表示 agent 活跃中，应入队由 middleware 安全 drain
            if (accepted === false) {
                this.enqueue(sessionId, msg);
            }
            return;
        }
        this.enqueue(sessionId, msg);
    }

    /** 将消息放入 pending 队列（由 middleware 在工具调用前 drain） */
    private static enqueue(sessionId: string, msg: PendingMessage): void {
        logger.log(
            `[BackgroundTaskRegistry] Queued for session "${sessionId}", type "${msg.type}"`
        );
        if (!this.pending.has(sessionId)) {
            this.pending.set(sessionId, []);
        }
        this.pending.get(sessionId)!.push(msg);
    }

    /** 
     * 当 agent 处于活跃状态时，handler 调用此方法将消息重新入队，
     * 由 createBackgroundMessageMiddleware 在安全时机 drain。
     */
    static requeueForMiddleware(sessionId: string, msg: PendingMessage): void {
        this.enqueue(sessionId, msg);
    }

    /** 添加后台任务的完成消息，并触发任务结算。
     *  @param skipMarkCompleted - 若为 true，不标记任务完成（用于非瞬态子代理）
     */
    static addMessage(
        sessionId: string,
        taskId: string,
        content: string,
        skipMarkCompleted?: boolean,
    ): void {
        // 1. 先标记任务完成（非瞬态子代理跳过，保持任务可见）
        if (!skipMarkCompleted) {
            this.markCompleted(taskId, content);
        }

        // 2. 构造 task_result 类型消息并投递给主会话
        const msg: PendingMessage = { 
            type: 'task_result',
            taskId, 
            content, 
            timestamp: Date.now() 
        };
        this.deliverToMainSession(sessionId, msg);
    }

    /**
     * 子代理完成任务通知：将任务标记为 idle（存活但空闲），同时投递消息到主会话。
     * 与 addMessage 的区别：不会标记为 completed，而是标记为 idle，表示子代理已完成主任务
     * 但保持存活，可以继续接收消息。
     */
    static addAgentCompletionNotice(
        sessionId: string,
        taskId: string,
        content: string,
    ): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'idle';
            task.endTime = Date.now();
            task.resultSummary = content.replace(/\n/g, ' ').substring(0, 200);
            logger.log(`[BackgroundTaskRegistry] Task "${taskId}" marked as idle (sub-agent alive)`);
        }

        const msg: PendingMessage = {
            type: 'task_result',
            taskId,
            content,
            timestamp: Date.now()
        };
        this.deliverToMainSession(sessionId, msg);
    }

    static registerHandler(sessionId: string, handler: SessionMessageHandler): void {
        this.handlers.set(sessionId, handler);
        logger.log(`[BackgroundTaskRegistry] Handler registered for session "${sessionId}"`);

        const queued = this.pending.get(sessionId);
        if (queued && queued.length > 0) {
            logger.log(
                `[BackgroundTaskRegistry] Draining ${queued.length} queued message(s) for session "${sessionId}"`
            );
            for (const msg of queued) {
                handler(msg);
            }
            this.pending.delete(sessionId);
        }
    }

    static unregisterHandler(sessionId: string): void {
        this.handlers.delete(sessionId);
        const queued = this.pending.get(sessionId);
        if (queued && queued.length > 0) {
            logger.warn(
                `[BackgroundTaskRegistry] Discarding ${queued.length} queued message(s) for destroyed session "${sessionId}"`
            );
            this.pending.delete(sessionId);
        }
    }

    static drainMessages(sessionId: string): PendingMessage[] {
        const msgs = this.pending.get(sessionId) || [];
        this.pending.delete(sessionId);
        return msgs;
    }

    static hasPending(sessionId: string): boolean {
        const msgs = this.pending.get(sessionId);
        return !!msgs && msgs.length > 0;
    }

    // ─── 代理间消息通信 ────────────────────────────────────────────────────

    /**
     * 注册代理消息监听器。
     * 子代理在后台启动时调用，用于接收其他代理发来的消息。
     */
    static registerAgentListener(
        sessionId: string,
        agentName: string,
        listener: AgentMessageListener,
    ): void {
        const key = `${sessionId}::${agentName}`;
        this.agentListeners.set(key, listener);
        logger.log(
            `[BackgroundTaskRegistry] AgentListener registered for "${agentName}" in session "${sessionId}"`
        );
        const queued = this.agentMsgQueues.get(key);
        if (queued && queued.length > 0) {
            logger.log(
                `[BackgroundTaskRegistry] Draining ${queued.length} queued agent message(s) for "${agentName}"`
            );
            for (const msg of queued) {
                listener(msg);
            }
            this.agentMsgQueues.delete(key);
        }
    }

    /**
     * 注销代理消息监听器。
     */
    static unregisterAgentListener(sessionId: string, agentName: string): void {
        const key = `${sessionId}::${agentName}`;
        this.agentListeners.delete(key);
        const queued = this.agentMsgQueues.get(key);
        if (queued && queued.length > 0) {
            logger.warn(
                `[BackgroundTaskRegistry] Discarding ${queued.length} queued agent message(s) for destroyed agent "${agentName}"`
            );
            this.agentMsgQueues.delete(key);
        }
    }

    /**
     * 将代理消息放入队列（当子代理处于活跃状态时，由 listener 调用）。
     * 消息将在子代理空闲时由 drainAgentMessages 取出并处理。
     */
    static queueAgentMessage(sessionId: string, agentName: string, msg: AgentMessage): void {
        const key = `${sessionId}::${agentName}`;
        if (!this.agentMsgQueues.has(key)) {
            this.agentMsgQueues.set(key, []);
        }
        this.agentMsgQueues.get(key)!.push(msg);
        logger.log(
            `[BackgroundTaskRegistry] Queued agent message for "${agentName}" (active), ` +
            `total queued: ${this.agentMsgQueues.get(key)!.length}`
        );
    }

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
    static addAgentMessage(
        sessionId: string,
        from: string,
        to: string,
        content: string,
    ): boolean {
        const msg: AgentMessage = { from, content, timestamp: Date.now() };
        const formatted = `\n\n📨 **[${from}] → [${to}]**:\n${content}`;

        // 1. 如果需要发给主会话（前端），直接构造 agent_message 类型消息投递，跳过任务生命周期
        if (to === 'all' || to === 'main') {
            const mainSessionMsg: PendingMessage = {
                type: 'agent_message',
                content: formatted,
                timestamp: Date.now()
            };
            this.deliverToMainSession(sessionId, mainSessionMsg);
        }

        // 2. 处理子代理的投递逻辑
        if (to === 'all') {
            const prefix = `${sessionId}::`;
            for (const [key, listener] of this.agentListeners) {
                if (key.startsWith(prefix)) {
                    const targetName = key.slice(prefix.length);
                    // 广播给其他子代理，排除发送方自身
                    if (targetName !== from) {
                        listener(msg);
                    }
                }
            }
        } else if (to !== 'main') {
            // 定向发给特定子代理
            const key = `${sessionId}::${to}`;
            const listener = this.agentListeners.get(key);
            if (listener) {
                listener(msg);
            } else {
                // 子代理已不在线（已完成/未启动），通知主会话投递失败而非静默丢弃
                logger.log(
                    `[BackgroundTaskRegistry] Agent message to "${to}" failed: listener not found`
                );
                this.deliverToMainSession(sessionId, {
                    type: 'agent_message',
                    content: `\n\n⚠️ **[System]** Message to \`${to}\` could not be delivered: agent is no longer active.`,
                    timestamp: Date.now()
                });
                return false;
            }
        }

        logger.log(
            `[BackgroundTaskRegistry] Agent message routed: [${from}] → [${to}]`
        );
        return true;
    }

    /**
     * 排空指定代理的待处理消息队列。
     */
    static drainAgentMessages(
        sessionId: string,
        agentName: string,
    ): AgentMessage[] {
        const key = `${sessionId}::${agentName}`;
        const msgs = this.agentMsgQueues.get(key) || [];
        this.agentMsgQueues.delete(key);
        return msgs;
    }

    static clear(): void {
        this.pending.clear();
        this.handlers.clear();
        this.tasks.clear();
        this.killFns.clear();
        this.agentListeners.clear();
        this.agentMsgQueues.clear();
    }
}