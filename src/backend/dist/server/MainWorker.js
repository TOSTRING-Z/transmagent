"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const logger_1 = require("../utils/logger");
const WebServer_1 = require("./WebServer");
if (!worker_threads_1.parentPort) {
    throw new Error('[MainWorker] This file must be run as a Worker thread.');
}
let webServer = null;
function onChatRequest(request) {
    worker_threads_1.parentPort.postMessage(request);
}
worker_threads_1.parentPort.on('message', async (task) => {
    const { type, requestId, result, config } = task;
    if (type === 'start') {
        // 初始化 WebServer
        const port = config?.port || 3005;
        const timeoutMs = config?.timeoutMs || 12 * 60 * 60 * 1000;
        webServer = new WebServer_1.WebServer(port, timeoutMs);
        webServer.on('chatRequest', onChatRequest);
        webServer.start();
        logger_1.logger.log('[MainWorker] WebServer started.');
    }
    else if (type === 'stop') {
        // 优雅关闭
        if (webServer) {
            webServer.removeListener('chatRequest', onChatRequest);
            webServer.stop();
            webServer = null;
        }
        logger_1.logger.log('[MainWorker] WebServer stopped.');
    }
    else if (requestId && webServer) {
        // 主线程返回的业务处理结果
        webServer.handleResponse({ requestId, result });
    }
});
//# sourceMappingURL=MainWorker.js.map