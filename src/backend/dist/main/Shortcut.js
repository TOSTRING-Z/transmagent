"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Shortcut = void 0;
const electron_1 = require("electron");
const logger_1 = require("../utils/logger");
const globals_1 = require("../utils/globals");
const CaptureMouse_1 = require("../mouse/CaptureMouse");
class Shortcut {
    windowManager;
    constructor(windowManager) {
        this.windowManager = windowManager;
    }
    init() {
        const shortcutKey = globals_1.utils.getConfig("short_cut");
        if (!shortcutKey) {
            console.warn("[Shortcut] No shortcut key configured.");
            return;
        }
        if (electron_1.globalShortcut.isRegistered(shortcutKey)) {
            logger_1.logger.log(`[Shortcut] '${shortcutKey}' is already registered.`);
        }
        electron_1.globalShortcut.register(shortcutKey, () => {
            (0, CaptureMouse_1.captureMouse)()
                .then((mousePosition) => {
                logger_1.logger.log("[Shortcut] Mouse captured:", mousePosition);
                this.windowManager.iconWindow?.create(mousePosition);
            })
                .catch((error) => {
                console.error("[Shortcut] Capture failed:", error);
            });
        });
        logger_1.logger.log(`[Shortcut] Registered global shortcut: ${shortcutKey}`);
    }
    destroy() {
        electron_1.globalShortcut.unregisterAll();
    }
}
exports.Shortcut = Shortcut;
//# sourceMappingURL=Shortcut.js.map