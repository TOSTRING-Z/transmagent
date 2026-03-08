import express, { Express, Request, Response } from 'express';
import { logger } from '../utils/logger';
import bodyParser from 'body-parser';
import { EventEmitter } from 'events';
import * as http from 'http';

interface PendingRequest {
    res: Response;
    timer: ReturnType<typeof setTimeout>;
}

interface ChatRequestPayload {
    requestId: string;
    cdata: {
        method: string;
        data?: any;
    };
}

interface HandleResponsePayload {
    requestId: string;
    result?: any;
    error?: { message: string };
}

export class WebServer extends EventEmitter {
    private app: Express;
    private port: number;
    private server: http.Server | null = null;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private readonly REQUEST_TIMEOUT_MS: number;

    constructor(port: number = 3005, timeoutMs: number = 12 * 60 * 60 * 1000) {
        super();
        this.app = express();
        this.port = port;
        this.REQUEST_TIMEOUT_MS = timeoutMs;

        this.app.use(bodyParser.json({ limit: '10mb' }));

        this.registerRoutes();
    }

    private registerRoutes(): void {
        this.app.post('/chat/list', async (_req: Request, res: Response) => {
            this.sendProcessingResponse(res, { method: 'list' });
        });

        this.app.post('/chat/checkout', (req: Request, res: Response) => {
            this.sendProcessingResponse(res, { method: 'checkout', data: req.body });
        });

        this.app.post('/chat/mode', (req: Request, res: Response) => {
            this.sendProcessingResponse(res, { method: 'mode', data: req.body });
        });

        this.app.post('/chat/completions', async (req: Request, res: Response) => {
            this.sendProcessingResponse(res, { method: 'completions', data: req.body });
        });

        // 健康检查端点
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({
                status: 'ok',
                uptime: process.uptime(),
                pending: this.pendingRequests.size
            });
        });
    }

    private generateRequestId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    private sendProcessingResponse(res: Response, cdata: { method: string; data?: any }): void {
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

        const payload: ChatRequestPayload = { requestId, cdata };
        this.emit('chatRequest', payload);
    }

    public handleResponse(response: HandleResponsePayload): void {
        const { requestId, result, error } = response;

        const pending = this.pendingRequests.get(requestId);
        if (!pending) return;

        // 清理
        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);

        if (pending.res.headersSent) return;

        if (error) {
            pending.res.status(500).json({
                error: 'Failed to process request',
                message: error.message
            });
        } else {
            pending.res.json(result);
        }
    }

    public start(): void {
        this.server = this.app.listen(this.port, () => {
            logger.log(`[WebServer] Listening on port ${this.port}`);
        });

        // 长连接场景：禁用服务器级超时
        this.server!.timeout = 0;
        this.server!.keepAliveTimeout = 0;
    }

    public stop(): void {
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
                logger.log('[WebServer] Server stopped.');
            });
            this.server = null;
        }
    }

    public getPendingCount(): number {
        return this.pendingRequests.size;
    }
}