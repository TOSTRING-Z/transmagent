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
export declare class ConfirmationWindow extends BaseWindow {
    private pendingResolve;
    private currentRequest;
    constructor(windowManager: WindowManager);
    create(): void;
    destroy(): void;
    setup(): void;
    /**
     * 显示确认对话框
     * @param request 确认请求信息
     * @returns 确认响应
     */
    showConfirmation(request: ConfirmationRequest): Promise<ConfirmationResponse>;
    /**
     * 解析待处理的确认请求
     */
    private resolvePending;
    /**
     * 检查窗口是否正在显示确认对话框
     */
    isShowing(): boolean;
}
