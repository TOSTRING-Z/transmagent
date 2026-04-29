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
    /** 所有后台任务字典（taskId → BgTaskInfo） */
    static tasks = new Map();
    /** sessionId → 待投递消息列表（Handler 注册前的暂存区） */
    static pending = new Map();
    /** sessionId → 即时消息处理器（ToolCall 注册） */
    static handlers = new Map();
    /** taskId → 中断函数（由 runInBackground 注册） */
    static killFns = new Map();
    /** "${sessionId}::${agentName}" → 代理消息监听器 */
    static agentListeners = new Map();
    /** "${sessionId}::${agentName}" → 待投递的代理消息队列（监听器注册前暂存） */
    static agentMsgQueues = new Map();
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
    /** 注册后台任务的进程中断函数（由 runInBackground 调用） */
    static registerProcess(taskId, killFn) {
        this.killFns.set(taskId, killFn);
        logger_1.logger.log(`[BackgroundTaskRegistry] Kill function registered for task "${taskId}"`);
    }
    /** 注销后台任务的进程中断函数（任务完成后调用） */
    static unregisterProcess(taskId) {
        this.killFns.delete(taskId);
    }
    /**
     * 中断指定后台任务。
     * @returns true 表示成功中断，false 表示任务不存在或已完成
     */
    static interruptTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            logger_1.logger.warn(`[BackgroundTaskRegistry] interruptTask: task "${taskId}" not found`);
            return false;
        }
        if (task.status !== 'running') {
            logger_1.logger.warn(`[BackgroundTaskRegistry] interruptTask: task "${taskId}" is already ${task.status}`);
            return false;
        }
        const killFn = this.killFns.get(taskId);
        if (killFn) {
            killFn(true); // force kill (SIGKILL)
            this.killFns.delete(taskId);
        }
        this.markFailed(taskId, 'Interrupted by user');
        logger_1.logger.log(`[BackgroundTaskRegistry] Task "${taskId}" interrupted`);
        return true;
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
    // ─── 主会话消息投递核心逻辑 ───────────────────────────────────────────────────
    /**
     * 内部方法：负责将消息投递给主代理（前端），处理即时投递和队列暂存
     */
    static deliverToMainSession(sessionId, msg) {
        const handler = this.handlers.get(sessionId);
        if (handler) {
            logger_1.logger.log(`[BackgroundTaskRegistry] Immediate delivery for session "${sessionId}", type "${msg.type}"`);
            handler(msg);
            return;
        }
        logger_1.logger.log(`[BackgroundTaskRegistry] Queued for session "${sessionId}" (no handler yet), type "${msg.type}"`);
        if (!this.pending.has(sessionId)) {
            this.pending.set(sessionId, []);
        }
        this.pending.get(sessionId).push(msg);
    }
    /** 添加后台任务的完成消息，并触发任务结算。
     *  @param skipMarkCompleted - 若为 true，不标记任务完成（用于非瞬态子代理）
     */
    static addMessage(sessionId, taskId, content, skipMarkCompleted) {
        // 1. 先标记任务完成（非瞬态子代理跳过，保持任务可见）
        if (!skipMarkCompleted) {
            this.markCompleted(taskId, content);
        }
        // 2. 构造 task_result 类型消息并投递给主会话
        const msg = {
            type: 'task_result',
            taskId,
            content,
            timestamp: Date.now()
        };
        this.deliverToMainSession(sessionId, msg);
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
    // ─── 代理间消息通信 ────────────────────────────────────────────────────
    /**
     * 注册代理消息监听器。
     * 子代理在后台启动时调用，用于接收其他代理发来的消息。
     */
    static registerAgentListener(sessionId, agentName, listener) {
        const key = `${sessionId}::${agentName}`;
        this.agentListeners.set(key, listener);
        logger_1.logger.log(`[BackgroundTaskRegistry] AgentListener registered for "${agentName}" in session "${sessionId}"`);
        const queued = this.agentMsgQueues.get(key);
        if (queued && queued.length > 0) {
            logger_1.logger.log(`[BackgroundTaskRegistry] Draining ${queued.length} queued agent message(s) for "${agentName}"`);
            for (const msg of queued) {
                listener(msg);
            }
            this.agentMsgQueues.delete(key);
        }
    }
    /**
     * 注销代理消息监听器。
     */
    static unregisterAgentListener(sessionId, agentName) {
        const key = `${sessionId}::${agentName}`;
        this.agentListeners.delete(key);
        const queued = this.agentMsgQueues.get(key);
        if (queued && queued.length > 0) {
            logger_1.logger.warn(`[BackgroundTaskRegistry] Discarding ${queued.length} queued agent message(s) for destroyed agent "${agentName}"`);
            this.agentMsgQueues.delete(key);
        }
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
    static addAgentMessage(sessionId, from, to, content) {
        const msg = { from, content, timestamp: Date.now() };
        const formatted = `\n\n📨 **[${from}] → [${to}]**:\n${content}`;
        // 1. 如果需要发给主会话（前端），直接构造 agent_message 类型消息投递，跳过任务生命周期
        if (to === 'all' || to === 'main') {
            const mainSessionMsg = {
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
        }
        else if (to !== 'main') {
            // 定向发给特定子代理
            const key = `${sessionId}::${to}`;
            const listener = this.agentListeners.get(key);
            if (listener) {
                listener(msg);
            }
            else {
                // 子代理已不在线（已完成/未启动），通知主会话投递失败而非静默丢弃
                logger_1.logger.log(`[BackgroundTaskRegistry] Agent message to "${to}" failed: listener not found`);
                this.deliverToMainSession(sessionId, {
                    type: 'agent_message',
                    content: `\n\n⚠️ **[System]** Message to \`${to}\` could not be delivered: agent is no longer active.`,
                    timestamp: Date.now()
                });
                return false;
            }
        }
        logger_1.logger.log(`[BackgroundTaskRegistry] Agent message routed: [${from}] → [${to}]`);
        return true;
    }
    /**
     * 排空指定代理的待处理消息队列。
     */
    static drainAgentMessages(sessionId, agentName) {
        const key = `${sessionId}::${agentName}`;
        const msgs = this.agentMsgQueues.get(key) || [];
        this.agentMsgQueues.delete(key);
        return msgs;
    }
    static clear() {
        this.pending.clear();
        this.handlers.clear();
        this.tasks.clear();
        this.killFns.clear();
        this.agentListeners.clear();
        this.agentMsgQueues.clear();
    }
}
exports.BackgroundTaskRegistry = BackgroundTaskRegistry;
//# sourceMappingURL=BackgroundTaskRegistry.js.map