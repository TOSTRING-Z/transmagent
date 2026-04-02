import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
export declare class IconWindow extends BaseWindow {
    width: number;
    height: number;
    private autoCloseTimer;
    constructor(windowManager: WindowManager);
    create(position?: {
        x: number;
        y: number;
    }): void;
    private resetAutoClose;
    destroy(): void;
    setup(): void;
}
