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
import { ToolInfo } from '../types';

// ─── 标准事件载荷类型定义 ──────────────────────────────────────────

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
    streamData: [payload: StreamPayload];
    toolData: [payload: StreamPayload];
    userData: [payload: StreamPayload];
    infoData: [payload: StreamPayload];
    handleOptions: [payload: any];
    agentRunning: [payload: any];
    agentIdle: [payload: any];
    handleRenameChat: [payload: any];
    securityIntercept: [payload: SecurityInterceptPayload];
    toolStart: [payload: ToolStartPayload];
    error: [err: Error];
}

// ─── 核心事件总线 ──────────────────────────────────────────────────

export class AgentEventEmitter extends EventEmitter {
    constructor() {
        super();
        // 提高监听器上限，避免多工具并发时警告
        this.setMaxListeners(50);
    }

    /** 类型安全的 emit 包装 */
    emitEvent<K extends keyof AgentEventMap>(
        event: K,
        ...args: AgentEventMap[K]
    ): boolean {
        return this.emit(event as string, ...args);
    }

    /** 类型安全的 on 包装 */
    onEvent<K extends keyof AgentEventMap>(
        event: K,
        listener: (...args: AgentEventMap[K]) => void
    ): this {
        return this.on(event as string, listener as any);
    }
}

// ─── Electron UI 控制器（桥接层）───────────────────────────────────
/**
 * 把 AgentEventEmitter 的事件桥接到 Electron IPC。
 * 仅在 Electron 运行时才实例化，与 Agent 核心完全隔离。
 */
export class ElectronUIController {
    private window: BrowserWindow | null;
    private emitter: AgentEventEmitter;

    constructor(emitter: AgentEventEmitter, window: BrowserWindow | null) {
        this.emitter = emitter;
        this.window = window;
        this.bindAll();
    }

    /** 更新窗口引用（窗口重建时使用） */
    public setWindow(window: BrowserWindow | null) {
        this.window = window;
    }

    private send(channel: string, payload: any) {
        this.window?.webContents.send(channel, payload);
    }

    private bindAll() {
        const { emitter } = this;

        emitter.onEvent('streamData',       (p) => this.send('streamData', p));
        emitter.onEvent('toolData',         (p) => this.send('toolData', p));
        emitter.onEvent('userData',         (p) => this.send('userData', p));
        emitter.onEvent('infoData',         (p) => this.send('infoData', p));
        emitter.onEvent('handleOptions',    (p) => this.send('handleOptions', p));
        emitter.onEvent('agentRunning',     (p) => this.send('agentRunning', p));
        emitter.onEvent('agentIdle',        (p) => this.send('agentIdle', p));
        emitter.onEvent('handleRenameChat', (p) => this.send('handleRenameChat', p));

        emitter.onEvent('securityIntercept', (p) =>
            this.send('streamData', { ...p, content: `\n\n---\n\n⚠️ **Security Intercept**: ${p.message}` })
        );

        emitter.onEvent('toolStart', (p) =>
            this.send('streamData', {
                ...p,
                content: `\n\n- 📋 **Task ${p.taskNumber}** | ${p.content}`,
                reasoning_content: p.reasoning_content,
            })
        );
    }

    /** 销毁：移除全部监听，防止内存泄漏 */
    public destroy() {
        this.emitter.removeAllListeners();
    }
}
