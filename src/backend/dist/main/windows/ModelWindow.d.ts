import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
export declare class ModelWindow extends BaseWindow {
    constructor(windowManager: WindowManager);
    create(): void;
    destroy(): void;
    setup(): void;
}
