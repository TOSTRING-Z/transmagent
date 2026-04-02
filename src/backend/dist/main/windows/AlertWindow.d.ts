import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
export declare class AlertWindow extends BaseWindow {
    private width;
    private height;
    private autoCloseTimer;
    constructor(windowManager: WindowManager);
    show(type: string, content: string): void;
    create(data?: {
        type: string;
        content: string;
    }): void;
    private resetAutoClose;
    destroy(): void;
    setup(): void;
}
