import { parentPort } from 'worker_threads';
import { logger } from '../utils/logger';
import { WebServer } from './WebServer';

if (!parentPort) {
    throw new Error('[MainWorker] This file must be run as a Worker thread.');
}

let webServer: WebServer | null = null;

interface WorkerTask {
    type?: string;
    requestId?: string;
    result?: any;
    // 主线程可传入初始化配置
    config?: {
        port?: number;
        timeoutMs?: number;
    };
}

interface ChatRequestPayload {
    requestId: string;
    cdata: {
        method: string;
        data?: any;
    };
}

function onChatRequest(request: ChatRequestPayload): void {
    parentPort!.postMessage(request);
}

parentPort.on('message', async (task: WorkerTask) => {
    const { type, requestId, result, config } = task;

    if (type === 'start') {
        // 初始化 WebServer
        const port = config?.port || 3005;
        const timeoutMs = config?.timeoutMs || 12 * 60 * 60 * 1000;

        webServer = new WebServer(port, timeoutMs);
        webServer.on('chatRequest', onChatRequest);
        webServer.start();

        logger.log('[MainWorker] WebServer started.');
    } else if (type === 'stop') {
        // 优雅关闭
        if (webServer) {
            webServer.removeListener('chatRequest', onChatRequest);
            webServer.stop();
            webServer = null;
        }
        logger.log('[MainWorker] WebServer stopped.');
    } else if (requestId && webServer) {
        // 主线程返回的业务处理结果
        webServer.handleResponse({ requestId, result });
    }
});