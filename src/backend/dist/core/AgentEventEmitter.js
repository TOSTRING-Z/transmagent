"use strict";
/**
 * AgentEventEmitter.ts
 *
 * 【职责】将 Agent 核心逻辑与 UI 层（Electron IPC）彻底解耦。
 * Agent 只负责 emit 标准事件，由外部控制器（ElectronUIController）
 * 监听事件并调用 window.webContents.send(...)。
 *
 * 这样 Agent 可以在纯 Node.js / CLI / 测试环境中运行，完全不依赖 Electron。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronUIController = exports.AgentEventEmitter = void 0;
const events_1 = require("events");
// ─── 核心事件总线 ──────────────────────────────────────────────────
class AgentEventEmitter extends events_1.EventEmitter {
    constructor() {
        super();
        // 提高监听器上限，避免多工具并发时警告
        this.setMaxListeners(50);
    }
    /** 类型安全的 emit 包装 */
    emitEvent(event, ...args) {
        return this.emit(event, ...args);
    }
    /** 类型安全的 on 包装 */
    onEvent(event, listener) {
        return this.on(event, listener);
    }
}
exports.AgentEventEmitter = AgentEventEmitter;
// ─── Electron UI 控制器（桥接层）───────────────────────────────────
/**
 * 把 AgentEventEmitter 的事件桥接到 Electron IPC。
 * 仅在 Electron 运行时才实例化，与 Agent 核心完全隔离。
 */
class ElectronUIController {
    window;
    emitter;
    constructor(emitter, window) {
        this.emitter = emitter;
        this.window = window;
        this.bindAll();
    }
    /** 更新窗口引用（窗口重建时使用） */
    setWindow(window) {
        this.window = window;
    }
    send(channel, payload) {
        this.window?.webContents.send(channel, payload);
    }
    bindAll() {
        const { emitter } = this;
        emitter.onEvent('clear', () => this.send('clear', null));
        emitter.onEvent('streamData', (p) => this.send('streamData', p));
        emitter.onEvent('toolData', (p) => this.send('toolData', p));
        emitter.onEvent('userData', (p) => this.send('userData', p));
        emitter.onEvent('infoData', (p) => this.send('infoData', p));
        emitter.onEvent('handleOptions', (p) => this.send('handleOptions', p));
        emitter.onEvent('agentRunning', (p) => this.send('agentRunning', p));
        emitter.onEvent('agentIdle', (p) => this.send('agentIdle', p));
        emitter.onEvent('handleRenameChat', (p) => this.send('handleRenameChat', p));
        emitter.onEvent('securityIntercept', (p) => this.send('streamData', { ...p, content: `\n\n---\n\n⚠️ **Security Intercept**: ${p.message}` }));
        emitter.onEvent('toolStart', (p) => this.send('streamData', {
            ...p,
            content: `\n\n- 📋 **Task ${p.taskNumber}** | ${p.content}`,
            reasoning_content: p.reasoning_content,
        }));
    }
    /** 销毁：移除全部监听，防止内存泄漏 */
    destroy() {
        this.emitter.removeAllListeners();
    }
}
exports.ElectronUIController = ElectronUIController;
//# sourceMappingURL=AgentEventEmitter.js.map