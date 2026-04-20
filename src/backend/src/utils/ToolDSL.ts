// --- 1. DSL 核心操作符 ---
export const ToolDSL = {
    all: (...fns) => (ctx) => fns.every(fn => fn(ctx)),
    any: (...fns) => (ctx) => fns.some(fn => fn(ctx)),
    not: (fn) => (ctx) => !fn(ctx),
    /** 始终返回 true 的断言函数，签名与其他 DSL 原语一致 */
    always: () => (_?: any) => true
};

// --- 2. 领域原语 (基础条件) ---
export const Primitives = {
    isSubagent: (ctx) => ctx.isSubagent,
    isMode: (modeKey) => (ctx) => ctx.currentMode === ctx.modes[modeKey],
    hasArg: (argKey) => (ctx) => !!ctx.args[argKey]
};