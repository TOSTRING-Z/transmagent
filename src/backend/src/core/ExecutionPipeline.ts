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
import { logger } from '../utils/logger';

// ─── 执行上下文 ─────────────────────────────────────────────────────

/**
 * 贯穿整条管道的上下文对象。
 * 中间件通过读写此对象来传递状态，取代过去直接 mutate this.state 的方式。
 */
export class ExecutionContext {
    public toolInfo: ToolInfo;
    public data: Record<string, any>;
    public observation: Observation | null = null;
    /** 是否取消当前工具执行（不写 pushToolMessage，静默跳过） */
    public cancelled: boolean = false;
    /** 需要立即挂起整个工具循环（如 ask_user 等待用户输入） */
    public suspendLoop: boolean = false;

    constructor(toolInfo: ToolInfo, data: Record<string, any>) {
        this.toolInfo = toolInfo;
        this.data = data;
    }
}

// ─── 中间件类型 ─────────────────────────────────────────────────────

export type NextFn = () => Promise<void>;
export type MiddlewareFn = (ctx: ExecutionContext, next: NextFn) => Promise<void>;

// ─── 管道容器 ───────────────────────────────────────────────────────

export class ExecutionPipeline {
    private middlewares: MiddlewareFn[] = [];

    /** 注册中间件（按注册顺序执行） */
    use(middleware: MiddlewareFn): this {
        this.middlewares.push(middleware);
        return this;
    }

    /** 执行管道 */
    async execute(ctx: ExecutionContext): Promise<void> {
        let index = 0;

        const dispatch = async (): Promise<void> => {
            if (index >= this.middlewares.length) return;
            const fn = this.middlewares[index++];
            await fn(ctx, dispatch);
        };

        await dispatch();
    }
}

// ─── 内置中间件工厂 ─────────────────────────────────────────────────

/**
 * 1. 审计中间件
 * 调用 LLMAssistant.auditToolCall()，若存在安全风险则终止管道。
 */
export function createAuditMiddleware(
    auditFn: (toolInfo: ToolInfo, data: Record<string, any>) => Promise<string | null>,
    emitSecurityIntercept: (toolInfo: ToolInfo, message: string, chatPayload: any, uuid: string) => void,
    getChatPayload: () => any,
): MiddlewareFn {
    return async (ctx, next) => {
        const auditError = await auditFn(ctx.toolInfo, ctx.data);
        if (auditError) {
            logger.warn(`[AuditMiddleware] Blocked tool "${ctx.toolInfo.tool_call_name}": ${auditError}`);
            emitSecurityIntercept(ctx.toolInfo, auditError, getChatPayload(), ctx.data.uuid);
            // 终止管道（不调用 next），告知外部跳过此工具
            ctx.cancelled = true;
            return;
        }
        await next();
    };
}

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
    showConfirmation(request: any): Promise<{ confirmed: boolean; rememberChoice: boolean }>;
    isAvailable(): boolean;
}

export function createConfirmationMiddleware(
    gate: ConfirmationGate,
    emitCancel: (message: string, chatPayload: any, uuid: string) => void,
    getChatPayload: () => any,
): MiddlewareFn {
    return async (ctx, next) => {
        const toolName = ctx.toolInfo.tool_call_name as string;

        if (!gate.isRequired(toolName) || !gate.isAvailable()) {
            await next();
            return;
        }

        // 检查记住的选择
        const remembered = gate.getRememberedChoice(toolName);
        if (remembered !== null) {
            if (remembered) {
                await next(); // 用户曾选择"始终允许"，直接通过
            } else {
                ctx.cancelled = true;
                const msg = `用户取消了高风险工具 ${toolName} 的执行（已记住的选择）`;
                emitCancel(msg, getChatPayload(), ctx.data.uuid);
            }
            return;
        }

        // 弹出确认窗口
        try {
            const request = gate.buildRequest(ctx.toolInfo);
            const response = await gate.showConfirmation(request);

            if (response.rememberChoice) {
                gate.setRememberedChoice(toolName, response.confirmed);
            }

            if (response.confirmed) {
                await next();
            } else {
                ctx.cancelled = true;
                const msg = `用户取消了高风险工具 ${toolName} 的执行`;
                emitCancel(msg, getChatPayload(), ctx.data.uuid);
            }
        } catch (err) {
            logger.error('[ConfirmationMiddleware] Confirmation window error:', err);
            // 确认窗口崩溃时，默认放行执行
            await next();
        }
    };
}

/**
 * 3. 执行中间件
 * 调用 act()，处理 observation，管理状态转换。
 * 这是管道的末端，不调用 next()。
 */
export function createExecutionMiddleware(
    actFn: (toolInfo: ToolInfo) => Promise<Observation>,
    handleObservationFn: (obs: Observation, toolInfo: ToolInfo, data: Record<string, any>) => void,
    isSuspended: () => boolean,
): MiddlewareFn {
    return async (ctx) => {
        if (ctx.cancelled) return; // 上游已取消，跳过

        const observation = await actFn(ctx.toolInfo);
        ctx.observation = observation;

        handleObservationFn(observation, ctx.toolInfo, ctx.data);

        // 如果执行后 agent 进入暂停状态（如 ask_user），通知外部循环中断
        if (isSuspended()) {
            ctx.suspendLoop = true;
        }
    };
}
