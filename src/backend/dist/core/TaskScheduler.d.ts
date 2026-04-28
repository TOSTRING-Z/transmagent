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
import { State } from './LLMBase';
export interface SchedulerOptions {
    /** 心跳检测间隔（秒），默认 60 */
    interval?: number;
    /** 是否强制启用心跳（即使无 recurring 任务） */
    forceEnabled?: boolean;
}
/** Agent 对 Scheduler 暴露的最小接口，避免循环依赖 */
export interface ISchedulableAgent {
    state: State;
    getDataDefault(params: Record<string, any>): Record<string, any>;
    callReAct(data: Record<string, any>, setUUID?: boolean): Promise<any>;
    /** 读取当前会话的 chatVars，用于判断是否存在 recurring 任务 */
    getChatVars(): Record<string, any>;
    /** 读取当前会话 uuid */
    getChatUUID(): string;
}
export declare class TaskScheduler {
    private agent;
    private intervalId;
    private options;
    constructor(agent: ISchedulableAgent, options?: SchedulerOptions);
    /** 启动调度器 */
    start(): void;
    /** 停止调度器，释放定时器资源 */
    stop(): void;
    /** 是否正在运行 */
    get isRunning(): boolean;
    private tick;
    /**
     * 判断本次心跳是否应当触发 ReAct 循环。
     * 规则：存在 recurring 任务 || forceEnabled 为 true
     */
    private shouldTriggerHeartbeat;
}
