"use strict";
/**
 * TaskScheduler.ts
 *
 * 【职责】将心跳（Heartbeat）和定时调度逻辑从 ToolCall 中完全剥离。
 * ToolCall / LLMBase 保持无状态、无定时器；TaskScheduler 作为
 * 外部观察者，在满足条件时调用 agent.callReAct(data)。
 *
 * 优点：
 * - Agent 构造函数不再注册定时器，生命周期清晰。
 * - Scheduler 可被独立测试、替换（如换成操作系统 cron）。
 * - 多个 Agent 实例可复用同一个 Scheduler。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const logger_1 = require("../utils/logger");
const public_1 = require("../utils/public");
const LLMBase_1 = require("./LLMBase");
class TaskScheduler {
    agent;
    intervalId = null;
    options;
    constructor(agent, options = {}) {
        this.agent = agent;
        const heartbeatConfig = (0, public_1.getDefaultConfig)('heartbeat') ?? {};
        this.options = {
            interval: options.interval ?? heartbeatConfig.interval ?? 60,
            forceEnabled: options.forceEnabled ?? !!heartbeatConfig.enabled,
        };
    }
    // ─── 公开 API ───────────────────────────────────────────────────
    /** 启动调度器 */
    start() {
        this.stop(); // 幂等：先清除已有定时器
        const intervalMs = this.options.interval * 1000;
        logger_1.logger.log(`[TaskScheduler] Started. Interval: ${this.options.interval}s`);
        this.intervalId = setInterval(() => this.tick(), intervalMs);
    }
    /** 停止调度器，释放定时器资源 */
    stop() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger_1.logger.log('[TaskScheduler] Stopped.');
        }
    }
    /** 是否正在运行 */
    get isRunning() {
        return this.intervalId !== null;
    }
    // ─── 内部心跳逻辑 ───────────────────────────────────────────────
    async tick() {
        const shouldRun = this.shouldTriggerHeartbeat();
        const agentIdle = this.agent.state === LLMBase_1.State.IDLE ||
            this.agent.state === LLMBase_1.State.FINAL;
        if (!agentIdle || !shouldRun)
            return;
        try {
            const time = new Date().toISOString();
            const query = `[SYSTEM HEARTBEAT @ ${time}] Evaluate your recurring tasks. ` +
                `If a task's trigger_condition is met, initiate the next cycle. ` +
                `If NO tasks are due, respond EXACTLY with [STANDBY].`;
            logger_1.logger.log(`[TaskScheduler] Triggering heartbeat at ${time}`);
            const data = this.agent.getDataDefault({ query });
            data.uuid = this.agent.getChatUUID();
            // 不设置 UUID（由 callReAct 内部控制），异步触发，不 await 以免阻塞定时器
            this.agent.callReAct(data, false).catch((err) => {
                logger_1.logger.error('[TaskScheduler] callReAct error:', err);
            });
        }
        catch (err) {
            logger_1.logger.error('[TaskScheduler] tick error:', err);
        }
    }
    /**
     * 判断本次心跳是否应当触发 ReAct 循环。
     * 规则：存在 recurring 任务 || forceEnabled 为 true
     */
    shouldTriggerHeartbeat() {
        if (this.options.forceEnabled)
            return true;
        try {
            const chatVars = this.agent.getChatVars();
            if (chatVars?.tasks) {
                return Object.values(chatVars.tasks).some((task) => task.type === 'recurring');
            }
        }
        catch (e) {
            logger_1.logger.error('[TaskScheduler] Error reading chatVars:', e);
        }
        return false;
    }
}
exports.TaskScheduler = TaskScheduler;
//# sourceMappingURL=TaskScheduler.js.map