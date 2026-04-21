/**
 * ExecutionPipeline.ts
 *
 * 【职责】将 step() 中的工具执行循环拆解为"职责链（Chain of Responsibility）"。
 *
 * 每个中间件（Middleware）是一个独立的、可测试的异步函数，接收 ExecutionContext，
 * 决定：① 调用 next() 将执行权传递给下一层；② 直接 return 终止链路。
 *
 * 当前三层中间件：
 *   auditMiddleware        → LLMAssistant 安全审计
 *   confirmationMiddleware → 高风险工具的 Human-in-the-loop 确认
 *   executionMiddleware    → 实际调用 act()，处理 observation
 */
import { ToolInfo } from '../types';
import { Observation } from './ToolCall';
/**
 * 贯穿整条管道的上下文对象。
 * 中间件通过读写此对象来传递状态，取代过去直接 mutate this.state 的方式。
 */
export declare class ExecutionContext {
    toolInfo: ToolInfo;
    data: Record<string, any>;
    observation: Observation | null;
    /** 是否取消当前工具执行（不写 pushToolMessage，静默跳过） */
    cancelled: boolean;
    /** 需要立即挂起整个工具循环（如 ask_user 等待用户输入） */
    suspendLoop: boolean;
    constructor(toolInfo: ToolInfo, data: Record<string, any>);
}
export type NextFn = () => Promise<void>;
export type MiddlewareFn = (ctx: ExecutionContext, next: NextFn) => Promise<void>;
export declare class ExecutionPipeline {
    private middlewares;
    /** 注册中间件（按注册顺序执行） */
    use(middleware: MiddlewareFn): this;
    /** 执行管道 */
    execute(ctx: ExecutionContext): Promise<void>;
}
/**
 * 1. 审计中间件
 * 调用 LLMAssistant.auditToolCall()，若存在安全风险则终止管道。
 */
export declare function createAuditMiddleware(auditFn: (toolInfo: ToolInfo, data: Record<string, any>) => Promise<string | null>, emitSecurityIntercept: (toolInfo: ToolInfo, message: string, chatPayload: any, uuid: string) => void, getChatPayload: () => any): MiddlewareFn;
/**
 * 2. 确认中间件（Human-in-the-loop）
 * 对标记了 require_confirmation 的高风险工具弹出确认窗口。
 * 若用户拒绝则 cancel；若用户确认则 pass through 继续执行。
 */
export interface ConfirmationGate {
    isRequired(toolName: string): boolean;
    getRememberedChoice(toolName: string): boolean | null;
    setRememberedChoice(toolName: string, confirmed: boolean): void;
    buildRequest(toolInfo: ToolInfo): any;
    showConfirmation(request: any): Promise<{
        confirmed: boolean;
        rememberChoice: boolean;
    }>;
    isAvailable(): boolean;
}
export declare function createConfirmationMiddleware(gate: ConfirmationGate, emitCancel: (message: string, chatPayload: any, uuid: string) => void, getChatPayload: () => any): MiddlewareFn;
/**
 * 3. 执行中间件
 * 调用 act()，处理 observation，管理状态转换。
 * 这是管道的末端，不调用 next()。
 */
export declare function createExecutionMiddleware(actFn: (toolInfo: ToolInfo) => Promise<Observation>, handleObservationFn: (obs: Observation, toolInfo: ToolInfo, data: Record<string, any>) => void, isSuspended: () => boolean): MiddlewareFn;
