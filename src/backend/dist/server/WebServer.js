"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const express_1 = __importDefault(require("express"));
const logger_1 = require("../utils/logger");
const body_parser_1 = __importDefault(require("body-parser"));
const events_1 = require("events");
class WebServer extends events_1.EventEmitter {
    app;
    port;
    server = null;
    pendingRequests = new Map();
    REQUEST_TIMEOUT_MS;
    constructor(port = 3005, timeoutMs = 12 * 60 * 60 * 1000) {
        super();
        this.app = (0, express_1.default)();
        this.port = port;
        this.REQUEST_TIMEOUT_MS = timeoutMs;
        this.app.use(body_parser_1.default.json({ limit: '10mb' }));
        this.registerRoutes();
    }
    registerRoutes() {
        this.app.post('/chat/list', async (_req, res) => {
            this.sendProcessingResponse(res, { method: 'list' });
        });
        this.app.post('/chat/checkout', (req, res) => {
            this.sendProcessingResponse(res, { method: 'checkout', data: req.body });
        });
        this.app.post('/chat/mode', (req, res) => {
            this.sendProcessingResponse(res, { method: 'mode', data: req.body });
        });
        this.app.post('/chat/completions', async (req, res) => {
            this.sendProcessingResponse(res, { method: 'completions', data: req.body });
        });
        // 健康检查端点
        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                uptime: process.uptime(),
                pending: this.pendingRequests.size
            });
        });
    }
    generateRequestId() {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
    sendProcessingResponse(res, cdata) {
        const requestId = this.generateRequestId();
        // 超时保护
        const timer = setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
                this.pendingRequests.delete(requestId);
                if (!res.headersSent) {
                    res.status(504).json({ error: 'Request timeout' });
                }
            }
        }, this.REQUEST_TIMEOUT_MS);
        this.pendingRequests.set(requestId, { res, timer });
        const payload = { requestId, cdata };
        this.emit('chatRequest', payload);
    }
    handleResponse(response) {
        const { requestId, result, error } = response;
        const pending = this.pendingRequests.get(requestId);
        if (!pending)
            return;
        // 清理
        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        if (pending.res.headersSent)
            return;
        if (error) {
            pending.res.status(500).json({
                error: 'Failed to process request',
                message: error.message
            });
        }
        else {
            pending.res.json(result);
        }
    }
    start() {
        this.server = this.app.listen(this.port, () => {
            logger_1.logger.log(`[WebServer] Listening on port ${this.port}`);
        });
        // 长连接场景：禁用服务器级超时
        this.server.timeout = 0;
        this.server.keepAliveTimeout = 0;
    }
    stop() {
        // 清理所有挂起请求
        this.pendingRequests.forEach((pending, id) => {
            clearTimeout(pending.timer);
            if (!pending.res.headersSent) {
                pending.res.status(503).json({ error: 'Server shutting down' });
            }
        });
        this.pendingRequests.clear();
        if (this.server) {
            this.server.close(() => {
                logger_1.logger.log('[WebServer] Server stopped.');
            });
            this.server = null;
        }
    }
    getPendingCount() {
        return this.pendingRequests.size;
    }
}
exports.WebServer = WebServer;
//# sourceMappingURL=WebServer.js.map