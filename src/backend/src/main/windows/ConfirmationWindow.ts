import { BrowserWindow, ipcMain, dialog } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';

export interface ConfirmationRequest {
    toolId: string;
    toolName: string;
    toolDescription?: string;
    confirmationMessage: string;
    executionDetails: any;
}

export interface ConfirmationResponse {
    confirmed: boolean;
    rememberChoice?: boolean;
}

export class ConfirmationWindow extends BaseWindow {
    private pendingResolve: ((response: ConfirmationResponse) => void) | null = null;
    private currentRequest: ConfirmationRequest | null = null;

    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create() {
        if (this.window) {
            // 窗口已存在，重新加载页面以确保状态重置
            this.window.loadFile('src/frontend/confirmation.html');
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }

        this.window = new BrowserWindow({
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
        ipcMain.on('confirmation-minimize-window', () => {
            this.window?.minimize();
        });

        ipcMain.on('confirmation-close-window', () => {
            this.window?.close();
        });
    }

    public destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
        this.resolvePending({ confirmed: false, rememberChoice: false });
    }

    public setup() {
        // 处理确认响应
        ipcMain.handle('confirmation-response', async (_, response: ConfirmationResponse) => {
            this.resolvePending(response);
            if (this.window) {
                this.window.close();
            }
            return true;
        });

        // 获取当前确认请求
        ipcMain.handle('get-confirmation-request', async () => {
            return this.currentRequest;
        });
    }

    /**
     * 显示确认对话框
     * @param request 确认请求信息
     * @returns 确认响应
     */
    public async showConfirmation(request: ConfirmationRequest): Promise<ConfirmationResponse> {
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
    private resolvePending(response: ConfirmationResponse) {
        if (this.pendingResolve) {
            this.pendingResolve(response);
            this.pendingResolve = null;
            this.currentRequest = null;
        }
    }

    /**
     * 检查窗口是否正在显示确认对话框
     */
    public isShowing(): boolean {
        return this.window !== null && !this.window.isDestroyed();
    }
}