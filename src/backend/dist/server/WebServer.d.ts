import { EventEmitter } from 'events';
interface HandleResponsePayload {
    requestId: string;
    result?: any;
    error?: {
        message: string;
    };
}
export declare class WebServer extends EventEmitter {
    private app;
    private port;
    private server;
    private pendingRequests;
    private readonly REQUEST_TIMEOUT_MS;
    constructor(port?: number, timeoutMs?: number);
    private registerRoutes;
    private generateRequestId;
    private sendProcessingResponse;
    handleResponse(response: HandleResponsePayload): void;
    start(): void;
    stop(): void;
    getPendingCount(): number;
}
export {};
