"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionPipeline = exports.ExecutionContext = void 0;
exports.createAuditMiddleware = createAuditMiddleware;
exports.createConfirmationMiddleware = createConfirmationMiddleware;
exports.createExecutionMiddleware = createExecutionMiddleware;
exports.createBackgroundMessageMiddleware = createBackgroundMessageMiddleware;
const logger_1 = require("../utils/logger");
const BackgroundTaskRegistry_1 = require("./BackgroundTaskRegistry");
// ─── 执行上下文 ─────────────────────────────────────────────────────
/**
 * 贯穿整条管道的上下文对象。
 * 中间件通过读写此对象来传递状态，取代过去直接 mutate this.state 的方式。
 */
class ExecutionContext {
    toolInfo;
    data;
    observation = null;
    /** 是否取消当前工具执行（不写 pushToolMessage，静默跳过） */
    cancelled = false;
    /** 需要立即挂起整个工具循环（如 ask_user 等待用户输入） */
    suspendLoop = false;
    constructor(toolInfo, data) {
        this.toolInfo = toolInfo;
        this.data = data;
    }
}
exports.ExecutionContext = ExecutionContext;
// ─── 管道容器 ───────────────────────────────────────────────────────
class ExecutionPipeline {
    middlewares = [];
    /** 注册中间件（按注册顺序执行） */
    use(middleware) {
        this.middlewares.push(middleware);
        return this;
    }
    /** 执行管道 */
    async execute(ctx) {
        let index = 0;
        const dispatch = async () => {
            if (index >= this.middlewares.length)
                return;
            const fn = this.middlewares[index++];
            await fn(ctx, dispatch);
        };
        await dispatch();
    }
}
exports.ExecutionPipeline = ExecutionPipeline;
// ─── 内置中间件工厂 ─────────────────────────────────────────────────
/**
 * 1. 审计中间件
 * 调用 LLMAssistant.auditToolCall()，若存在安全风险则终止管道。
 */
function createAuditMiddleware(auditFn, emitSecurityIntercept, getChatPayload) {
    return async (ctx, next) => {
        const auditError = await auditFn(ctx.toolInfo, ctx.data);
        if (auditError) {
            logger_1.logger.warn(`[AuditMiddleware] Blocked tool "${ctx.toolInfo.tool_call_name}": ${auditError}`);
            emitSecurityIntercept(ctx.toolInfo, auditError, getChatPayload(), ctx.data.uuid);
            // 终止管道（不调用 next），告知外部跳过此工具
            ctx.cancelled = true;
            return;
        }
        await next();
    };
}
function createConfirmationMiddleware(gate, emitCancel, getChatPayload) {
    return async (ctx, next) => {
        const toolName = ctx.toolInfo.tool_call_name;
        if (!gate.isRequired(toolName) || !gate.isAvailable()) {
            await next();
            return;
        }
        // 检查记住的选择
        const remembered = gate.getRememberedChoice(toolName);
        if (remembered !== null) {
            if (remembered) {
                await next(); // 用户曾选择"始终允许"，直接通过
            }
            else {
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
            }
            else {
                ctx.cancelled = true;
                const msg = `用户取消了高风险工具 ${toolName} 的执行`;
                emitCancel(msg, getChatPayload(), ctx.data.uuid);
            }
        }
        catch (err) {
            logger_1.logger.error('[ConfirmationMiddleware] Confirmation window error:', err);
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
function createExecutionMiddleware(actFn, handleObservationFn, isSuspended) {
    return async (ctx) => {
        if (ctx.cancelled)
            return; // 上游已取消，跳过
        const observation = await actFn(ctx.toolInfo);
        ctx.observation = observation;
        handleObservationFn(observation, ctx.toolInfo, ctx.data);
        // 如果执行后 agent 进入暂停状态（如 ask_user），通知外部循环中断
        if (isSuspended()) {
            ctx.suspendLoop = true;
        }
    };
}
/**
 * 4. 后台消息接收中间件
 *
 * 【职责】在每个工具调用执行前，检查 BackgroundTaskRegistry 中是否有
 * 属于当前会话的后台任务完成消息。若存在，则将其逐条作为用户消息注入到
 * ChatManager 消息队列末尾，使 LLM 在下一轮 step() 中能自然感知到。
 *
 * 【注入时机】在当前工具 pipeline 的最前端执行，先于 audit/confirmation/execution。
 * 这意味着：
 *   - 后台任务结果会在当前 step 的下一个工具调用之前被 LLM 看到。
 *   - 不会打断正在执行的工具调用链。
 *
 * @param getSessionId   获取当前会话 ID 的函数
 * @param pushUserMessage 将消息推入当前会话 ChatManager 的函数
 */
function createBackgroundMessageMiddleware(getSessionId, pushUserMessage) {
    return async (ctx, next) => {
        const sessionId = getSessionId();
        if (!sessionId) {
            await next();
            return;
        }
        const pendingMessages = BackgroundTaskRegistry_1.BackgroundTaskRegistry.drainMessages(sessionId);
        for (const pending of pendingMessages) {
            logger_1.logger.log(`[BackgroundMsgMiddleware] Injecting background task "${pending.taskId}" ` +
                `into session "${sessionId}"`);
            pushUserMessage({
                content: `[Background Task \`${pending.taskId}\` Completed]\n\n${pending.content}`,
            });
        }
        await next();
    };
}
//# sourceMappingURL=ExecutionPipeline.js.map