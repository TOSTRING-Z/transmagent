/**
 * 初始化全局代理 (必须在所有HTTP请求之前)
 * 使用模块级标志确保只执行一次
 */
export declare function bootstrapGlobalProxy(): void;
/**
 * 检查代理是否已成功初始化
 */
export declare function isProxyReady(): boolean;
