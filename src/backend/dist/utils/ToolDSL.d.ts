export declare const ToolDSL: {
    all: (...fns: any[]) => (ctx: any) => boolean;
    any: (...fns: any[]) => (ctx: any) => boolean;
    not: (fn: any) => (ctx: any) => boolean;
    always: () => boolean;
};
export declare const Primitives: {
    isSubagent: (ctx: any) => any;
    isMode: (modeKey: any) => (ctx: any) => boolean;
    hasArg: (argKey: any) => (ctx: any) => boolean;
};
