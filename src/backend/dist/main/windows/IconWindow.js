"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IconWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
class IconWindow extends BaseWindow_1.BaseWindow {
    width = 200;
    height = 40;
    autoCloseTimer = null;
    constructor(windowManager) {
        super(windowManager);
    }
    create(position) {
        if (!position)
            return;
        const x = position.x;
        const y = position.y > 50 ? position.y - 50 : position.y;
        const autoCloseMs = (globals_1.utils.getConfig("icon_time") || 5) * 1000;
        if (this.window) {
            this.window.setPosition(x, y);
            this.resetAutoClose(autoCloseMs);
            return;
        }
        this.window = new electron_1.BrowserWindow({
            width: this.width,
            height: this.height,
            x, y,
            transparent: true,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            resizable: false,
            focusable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        this.window.loadFile('src/frontend/icon.html');
        this.window.setIgnoreMouseEvents(false);
        this.window.on('closed', () => { this.window = null; });
        this.resetAutoClose(autoCloseMs);
    }
    resetAutoClose(ms) {
        if (this.autoCloseTimer)
            clearTimeout(this.autoCloseTimer);
        this.autoCloseTimer = setTimeout(() => this.destroy(), ms);
    }
    destroy() {
        if (this.autoCloseTimer) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }
    setup() {
        electron_1.ipcMain.on('concat-clicked', () => {
            globals_1.globalState.concat = true;
            this.destroy();
        });
        electron_1.ipcMain.on('translation-clicked', () => {
            globals_1.globalState.concat = false;
            const mainWin = this.windowManager.mainWindow;
            mainWin.sendQuery({ query: globals_1.globalState.last_clipboard_content || "" });
            this.destroy();
        });
        electron_1.ipcMain.on('submit-clicked', () => {
            globals_1.globalState.concat = false;
            const mainWin = this.windowManager.mainWindow;
            mainWin.sendQuery({ query: globals_1.globalState.last_clipboard_content || "" });
            this.destroy();
        });
        electron_1.ipcMain.on('clear-clicked', () => {
            globals_1.globalState.concat = false;
            this.destroy();
            globals_1.globalState.last_clipboard_content = "";
            electron_1.clipboard.writeText("");
        });
    }
}
exports.IconWindow = IconWindow;
//# sourceMappingURL=IconWindow.js.map