import { globalShortcut } from 'electron'
import { logger } from '../utils/logger';
import { WindowManager } from './windows/WindowManager';
import { captureMouse } from '../mouse/CaptureMouse';

export class Shortcut {
    private windowManager: WindowManager;

    constructor(windowManager: WindowManager) {
        this.windowManager = windowManager;
    }

    public init(): void {
        const shortcutKey: string = WindowManager.instance.mainWindow.session().utils.getConfig("short_cut");

        if (!shortcutKey) {
            console.warn("[Shortcut] No shortcut key configured.");
            return;
        }

        if (globalShortcut.isRegistered(shortcutKey)) {
            logger.log(`[Shortcut] '${shortcutKey}' is already registered.`);
        }

        globalShortcut.register(shortcutKey, () => {
            captureMouse()
                .then((mousePosition: any) => {
                    logger.log("[Shortcut] Mouse captured:", mousePosition);
                    this.windowManager.iconWindow?.create(mousePosition);
                })
                .catch((error: any) => {
                    console.error("[Shortcut] Capture failed:", error);
                });
        });

        logger.log(`[Shortcut] Registered global shortcut: ${shortcutKey}`);
    }

    public destroy(): void {
        globalShortcut.unregisterAll();
    }
}