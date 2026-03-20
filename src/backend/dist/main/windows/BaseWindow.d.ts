import { BrowserWindow } from 'electron';
import { WindowManager } from './WindowManager';
export declare abstract class BaseWindow {
    windowManager: WindowManager;
    window: BrowserWindow | null;
    constructor(windowManager: WindowManager);
    abstract create(...args: any[]): void;
    abstract destroy(): void;
    abstract setup(): void;
}
