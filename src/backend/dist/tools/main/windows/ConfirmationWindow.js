"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
class ConfirmationWindow extends BaseWindow_1.BaseWindow {
    constructor(windowManager) {
        super(windowManager);
        this.pendingResolve = null;
        this.currentRequest = null;
    }
    create() {
        if (this.window) {
            // 窗口已存在，重新加载页面以确保状态重置
            this.window.loadFile('src/frontend/confirmation.html');
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }
        this.window = new electron_1.BrowserWindow({
            width: 500,
            height: 400,
            frame: false,
            transparent: true,
            resizable: false,
            alwaysOnTop: true,
            modal: true,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        this.window.loadFile('src/frontend/confirmation.html');
        this.window.on('closed', () => {
            this.window = null;
            this.resolvePending({ confirmed: false, rememberChoice: false });
        });
        // 窗口控制IPC
        electron_1.ipcMain.on('confirmation-minimize-window', () => {
            this.window?.minimize();
        });
        electron_1.ipcMain.on('confirmation-close-window', () => {
            this.window?.close();
        });
    }
    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
        this.resolvePending({ confirmed: false, rememberChoice: false });
    }
    setup() {
        // 处理确认响应
        electron_1.ipcMain.handle('confirmation-response', async (_, response) => {
            this.resolvePending(response);
            if (this.window) {
                this.window.close();
            }
            return true;
        });
        // 获取当前确认请求
        electron_1.ipcMain.handle('get-confirmation-request', async () => {
            return this.currentRequest;
        });
    }
    /**
     * 显示确认对话框
     * @param request 确认请求信息
     * @returns 确认响应
     */
    async showConfirmation(request) {
        return new Promise((resolve) => {
            this.currentRequest = request;
            this.pendingResolve = resolve;
            // 创建或显示窗口
            this.create();
            // 等待窗口准备好后显示
            this.window?.once('ready-to-show', () => {
                if (this.window) {
                    this.window.show();
                    this.window.focus();
                }
            });
        });
    }
    /**
     * 解析待处理的确认请求
     */
    resolvePending(response) {
        if (this.pendingResolve) {
            this.pendingResolve(response);
            this.pendingResolve = null;
            this.currentRequest = null;
        }
    }
    /**
     * 检查窗口是否正在显示确认对话框
     */
    isShowing() {
        return this.window !== null && !this.window.isDestroyed();
    }
}
exports.ConfirmationWindow = ConfirmationWindow;
