"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackgroundTaskRegistry = void 0;
const logger_1 = require("../utils/logger");
class BackgroundTaskRegistry {
    // ─── 生命周期追踪 ──────────────────────────────────────────────────────
    static addTaskStart(sessionId, taskId, toolName, command) {
        this.tasks.set(taskId, {
            taskId,
            sessionId,
            toolName,
            commandSummary: command.replace(/\n/g, ' ').substring(0, 80),
            status: 'running',
            startTime: Date.now(),
        });
        logger_1.logger.log(`[BackgroundTaskRegistry] Task "${taskId}" (${toolName}) started for session "${sessionId}"`);
    }
    static markCompleted(taskId, resultSummary) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'completed';
            task.endTime = Date.now();
            task.resultSummary = resultSummary.replace(/\n/g, ' ').substring(0, 200);
            logger_1.logger.log(`[BackgroundTaskRegistry] Task "${taskId}" completed`);
        }
    }
    static markFailed(taskId, errorSummary) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'failed';
            task.endTime = Date.now();
            task.resultSummary = errorSummary.replace(/\n/g, ' ').substring(0, 200);
            logger_1.logger.log(`[BackgroundTaskRegistry] Task "${taskId}" failed`);
        }
    }
    /** 返回所有任务列表（按启动时间降序），供前端展示 */
    static getAll() {
        return Array.from(this.tasks.values()).sort((a, b) => b.startTime - a.startTime);
    }
    /** 返回指定会话的任务列表 */
    static getBySession(sessionId) {
        return this.getAll().filter((t) => t.sessionId === sessionId);
    }
    /** 清空已完成/失败的任务（保留 running） */
    static clearFinished() {
        for (const [id, task] of this.tasks) {
            if (task.status !== 'running') {
                this.tasks.delete(id);
            }
        }
    }
    // ─── 消息投递 ──────────────────────────────────────────────────────────
    static addMessage(sessionId, taskId, content) {
        const msg = { taskId, content, timestamp: Date.now() };
        // 先标记任务完成
        this.markCompleted(taskId, content);
        const handler = this.handlers.get(sessionId);
        if (handler) {
            logger_1.logger.log(`[BackgroundTaskRegistry] Immediate delivery for session "${sessionId}", task "${taskId}"`);
            handler(msg);
            return;
        }
        logger_1.logger.log(`[BackgroundTaskRegistry] Queued for session "${sessionId}" (no handler yet), task "${taskId}"`);
        if (!this.pending.has(sessionId)) {
            this.pending.set(sessionId, []);
        }
        this.pending.get(sessionId).push(msg);
    }
    static registerHandler(sessionId, handler) {
        this.handlers.set(sessionId, handler);
        logger_1.logger.log(`[BackgroundTaskRegistry] Handler registered for session "${sessionId}"`);
        const queued = this.pending.get(sessionId);
        if (queued && queued.length > 0) {
            logger_1.logger.log(`[BackgroundTaskRegistry] Draining ${queued.length} queued message(s) for session "${sessionId}"`);
            for (const msg of queued) {
                handler(msg);
            }
            this.pending.delete(sessionId);
        }
    }
    static unregisterHandler(sessionId) {
        this.handlers.delete(sessionId);
        const queued = this.pending.get(sessionId);
        if (queued && queued.length > 0) {
            logger_1.logger.warn(`[BackgroundTaskRegistry] Discarding ${queued.length} queued message(s) for destroyed session "${sessionId}"`);
            this.pending.delete(sessionId);
        }
    }
    static drainMessages(sessionId) {
        const msgs = this.pending.get(sessionId) || [];
        this.pending.delete(sessionId);
        return msgs;
    }
    static hasPending(sessionId) {
        const msgs = this.pending.get(sessionId);
        return !!msgs && msgs.length > 0;
    }
    static clear() {
        this.pending.clear();
        this.handlers.clear();
        this.tasks.clear();
    }
}
exports.BackgroundTaskRegistry = BackgroundTaskRegistry;
/** 所有后台任务字典（taskId → BgTaskInfo） */
BackgroundTaskRegistry.tasks = new Map();
/** sessionId → 待投递消息列表（Handler 注册前的暂存区） */
BackgroundTaskRegistry.pending = new Map();
/** sessionId → 即时消息处理器（ToolCall 注册） */
BackgroundTaskRegistry.handlers = new Map();
