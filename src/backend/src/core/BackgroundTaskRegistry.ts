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

export class BackgroundTaskRegistry {
    /** 所有后台任务字典（taskId → BgTaskInfo） */
    private static tasks: Map<string, BgTaskInfo> = new Map();

    /** sessionId → 待投递消息列表（Handler 注册前的暂存区） */
    private static pending: Map<string, PendingMessage[]> = new Map();

    /** sessionId → 即时消息处理器（ToolCall 注册） */
    private static handlers: Map<string, SessionMessageHandler> = new Map();

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

    /** 清空已完成/失败的任务（保留 running） */
    static clearFinished(): void {
        for (const [id, task] of this.tasks) {
            if (task.status !== 'running') {
                this.tasks.delete(id);
            }
        }
    }

    // ─── 消息投递 ──────────────────────────────────────────────────────────

    static addMessage(sessionId: string, taskId: string, content: string): void {
        const msg: PendingMessage = { taskId, content, timestamp: Date.now() };

        // 先标记任务完成
        this.markCompleted(taskId, content);

        const handler = this.handlers.get(sessionId);
        if (handler) {
            logger.log(
                `[BackgroundTaskRegistry] Immediate delivery for session "${sessionId}", task "${taskId}"`
            );
            handler(msg);
            return;
        }

        logger.log(
            `[BackgroundTaskRegistry] Queued for session "${sessionId}" (no handler yet), task "${taskId}"`
        );
        if (!this.pending.has(sessionId)) {
            this.pending.set(sessionId, []);
        }
        this.pending.get(sessionId)!.push(msg);
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

    static clear(): void {
        this.pending.clear();
        this.handlers.clear();
        this.tasks.clear();
    }
}
