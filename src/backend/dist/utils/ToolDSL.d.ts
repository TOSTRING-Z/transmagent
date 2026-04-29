export declare const ToolDSL: {
    all: (...fns: any[]) => (ctx: any) => boolean;
    any: (...fns: any[]) => (ctx: any) => boolean;
    not: (fn: any) => (ctx: any) => boolean;
    /** 始终返回 true 的断言函数，签名与其他 DSL 原语一致 */
    always: () => (_?: any) => boolean;
};
export declare const Primitives: {
    isSubagent: (ctx: any) => any;
    isMode: (modeKey: any) => (ctx: any) => boolean;
    hasArg: (argKey: any) => (ctx: any) => boolean;
    isAgentMode: (agentModeKey: string) => (ctx: any) => boolean;
};
