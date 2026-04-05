"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
const WindowManager_1 = require("./WindowManager");
class AlertWindow extends BaseWindow_1.BaseWindow {
    width = 800;
    height = 100;
    autoCloseTimer = null;
    constructor(windowManager) {
        super(windowManager);
    }
    show(type, content) {
        this.create({ type, content });
    }
    create(data) {
        const display = electron_1.screen.getPrimaryDisplay();
        const x = Math.round((display.workAreaSize.width - this.width) / 2);
        const y = 20;
        const autoCloseMs = (WindowManager_1.WindowManager.instance.mainWindow.session().utils.getConfig("icon_time") || 5) * 1000;
        if (this.window) {
            this.window.setPosition(x, y);
            if (data)
                this.window.webContents.send('show-log', data);
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
        this.window.loadFile('src/frontend/alert.html');
        this.window.setIgnoreMouseEvents(false);
        this.window.on('closed', () => { this.window = null; });
        this.window.webContents.on('did-finish-load', () => {
            if (data)
                this.window?.webContents.send('show-log', data);
        });
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
        electron_1.ipcMain.on('close-clicked', () => this.destroy());
    }
}
exports.AlertWindow = AlertWindow;
//# sourceMappingURL=AlertWindow.js.map