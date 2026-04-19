"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapGlobalProxy = bootstrapGlobalProxy;
exports.isProxyReady = isProxyReady;
const logger_1 = require("./logger");
const global_agent_1 = __importDefault(require("global-agent"));
// 全局代理初始化标志 - 确保只在第一次调用时执行
let proxyBootstrapAttempted = false;
let proxyBootstrapComplete = false;
/**
 * 初始化全局代理 (必须在所有HTTP请求之前)
 * 使用模块级标志确保只执行一次
 */
function bootstrapGlobalProxy() {
    // 防止重复执行
    if (proxyBootstrapAttempted) {
        return;
    }
    proxyBootstrapAttempted = true;
    // 从环境变量获取代理地址
    const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY ||
        process.env.http_proxy || process.env.HTTP_PROXY ||
        process.env.ALL_PROXY || process.env.all_proxy;
    if (proxyUrl) {
        // 设置全局代理环境变量
        process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
        logger_1.logger.log(`Global proxy bootstrapped: ${proxyUrl}`);
    }
    // 初始化 global-agent (自动让所有 HTTP/HTTPS 请求使用代理)
    try {
        global_agent_1.default.bootstrap();
        proxyBootstrapComplete = true;
    }
    catch (e) {
        logger_1.logger.warn('Global proxy bootstrap failed, falling back to per-request agent');
    }
}
/**
 * 检查代理是否已成功初始化
 */
function isProxyReady() {
    return proxyBootstrapComplete;
}
//# sourceMappingURL=proxy.js.map