import { BrowserWindow } from 'electron';
import { WindowManager } from './WindowManager';
import { Utils } from '../../utils/Utils';
export declare abstract class BaseWindow {
    windowManager: WindowManager;
    window: BrowserWindow | null;
    utils: (() => Utils);
    constructor(windowManager: WindowManager);
    abstract create(...args: any[]): void;
    abstract destroy(): void;
    abstract setup(): void;
}
