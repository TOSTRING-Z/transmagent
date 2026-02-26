import { globalShortcut } from 'electron';
import { utils } from '../utils/globals';
import { WindowManager } from './windows/WindowManager';

// captureMouse 暂未 TS 化，保持 require
const { captureMouse } = require('../mouse/capture_mouse');

export class Shortcut {
    private windowManager: WindowManager;

    constructor(windowManager: WindowManager) {
        this.windowManager = windowManager;
    }

    public init(): void {
        const shortcutKey: string = utils.getConfig("short_cut");

        if (!shortcutKey) {
            console.warn("[Shortcut] No shortcut key configured.");
            return;
        }

        if (globalShortcut.isRegistered(shortcutKey)) {
            console.log(`[Shortcut] '${shortcutKey}' is already registered.`);
        }

        globalShortcut.register(shortcutKey, () => {
            captureMouse()
                .then((mousePosition: any) => {
                    console.log("[Shortcut] Mouse captured:", mousePosition);
                    this.windowManager.iconWindow?.create(mousePosition);
                })
                .catch((error: any) => {
                    console.error("[Shortcut] Capture failed:", error);
                });
        });

        console.log(`[Shortcut] Registered global shortcut: ${shortcutKey}`);
    }

    public destroy(): void {
        globalShortcut.unregisterAll();
    }
}