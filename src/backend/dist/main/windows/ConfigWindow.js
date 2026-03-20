"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
const { Plugins } = require('../../core/Plugins');
class ConfigWindow extends BaseWindow_1.BaseWindow {
    constructor(windowManager) {
        super(windowManager);
    }
    create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }
        this.window = new electron_1.BrowserWindow({
            width: 600,
            height: 600,
            frame: false,
            transparent: true,
            resizable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        this.window.loadFile('src/frontend/config.html');
        this.window.on('closed', () => { this.window = null; });
        electron_1.ipcMain.on('minimize-window', () => {
            electron_1.BrowserWindow.getFocusedWindow()?.minimize();
        });
        electron_1.ipcMain.on('close-window', () => {
            electron_1.BrowserWindow.getFocusedWindow()?.close();
        });
    }
    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }
    setup() {
        electron_1.ipcMain.handle('get-config', () => globals_1.utils.getConfig());
        electron_1.ipcMain.handle('set-config', (_, config) => {
            let state = globals_1.utils.setConfig(config);
            this.windowManager.mainWindow.updateVersionsSubmenu();
            const plugins = new Plugins();
            plugins.init();
            this.windowManager.alertWindow?.show("success", "config saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
            return state;
        });
    }
}
exports.ConfigWindow = ConfigWindow;
//# sourceMappingURL=ConfigWindow.js.map