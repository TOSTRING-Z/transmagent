/**
 * AgentEventEmitter.ts
 *
 * 【职责】将 Agent 核心逻辑与 UI 层（Electron IPC）彻底解耦。
 * Agent 只负责 emit 标准事件，由外部控制器（ElectronUIController）
 * 监听事件并调用 window.webContents.send(...)。
 *
 * 这样 Agent 可以在纯 Node.js / CLI / 测试环境中运行，完全不依赖 Electron。
 */
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron/main';
export interface StreamPayload {
    content?: string;
    reasoning_content?: string;
    end?: boolean;
    [key: string]: any;
}
export interface ToolStartPayload {
    taskNumber: string;
    content: string;
    reasoning_content?: string;
    [key: string]: any;
}
export interface SecurityInterceptPayload {
    message: string;
    [key: string]: any;
}
export interface ConfirmationRequest {
    toolId: string;
    toolName: string;
    toolDescription: string;
    confirmationMessage: string;
    executionDetails: any;
}
export interface AgentEventMap {
    clear: [];
    streamData: [payload: StreamPayload];
    toolData: [payload: StreamPayload];
    userData: [payload: StreamPayload];
    infoData: [payload: StreamPayload];
    handleOptions: [payload: any];
    handleQuestions: [payload: any];
    agentRunning: [payload: any];
    agentIdle: [payload: any];
    handleRenameChat: [payload: any];
    securityIntercept: [payload: SecurityInterceptPayload];
    toolStart: [payload: ToolStartPayload];
    error: [err: Error];
}
export declare class AgentEventEmitter extends EventEmitter {
    constructor();
    /** 类型安全的 emit 包装 */
    emitEvent<K extends keyof AgentEventMap>(event: K, ...args: AgentEventMap[K]): boolean;
    /** 类型安全的 on 包装 */
    onEvent<K extends keyof AgentEventMap>(event: K, listener: (...args: AgentEventMap[K]) => void): this;
}
/**
 * 把 AgentEventEmitter 的事件桥接到 Electron IPC。
 * 仅在 Electron 运行时才实例化，与 Agent 核心完全隔离。
 */
export declare class ElectronUIController {
    private window;
    private emitter;
    constructor(emitter: AgentEventEmitter, window: BrowserWindow | null);
    /** 更新窗口引用（窗口重建时使用） */
    setWindow(window: BrowserWindow | null): void;
    private send;
    private bindAll;
    /** 销毁：移除全部监听，防止内存泄漏 */
    destroy(): void;
}
