import { BrowserWindow } from 'electron';
import { WindowManager } from './WindowManager';
import { Utils } from '../../utils/Utils';
import { store } from '../../utils/globals';

export abstract class BaseWindow {
    public windowManager: WindowManager;
    public window: BrowserWindow | null;
    public utils: (() => Utils);

    constructor(windowManager: WindowManager) {
        this.windowManager = windowManager;
        this.window = null;
        this.utils = () => windowManager.mainWindow ? windowManager.mainWindow.session().utils : new Utils(store.get('agentMode', 'transagent'));
    }

    // 抽象方法，子类必须实现
    abstract create(...args: any[]): void;
    abstract destroy(): void;
    abstract setup(): void;
}