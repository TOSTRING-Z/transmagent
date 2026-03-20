import { WindowManager } from './windows/WindowManager';
export declare class Shortcut {
    private windowManager;
    constructor(windowManager: WindowManager);
    init(): void;
    destroy(): void;
}
