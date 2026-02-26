import { BrowserWindow } from 'electron';
import { WindowManager } from './WindowManager';

export abstract class BaseWindow {
    public windowManager: WindowManager;
    public window: BrowserWindow | null;

    constructor(windowManager: WindowManager) {
        this.windowManager = windowManager;
        this.window = null;
    }

    // 抽象方法，子类必须实现
    abstract create(...args: any[]): void;
    abstract destroy(): void;
    abstract setup(): void;
}