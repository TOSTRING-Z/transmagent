"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
class ToolWindow extends BaseWindow_1.BaseWindow {
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
            width: 800,
            height: 600,
            frame: false,
            transparent: true,
            resizable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        this.window.loadFile('src/frontend/tool.html');
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
        electron_1.ipcMain.handle('get-tools', async () => globals_1.utils.getConfig("plugins") || {});
        electron_1.ipcMain.handle('save-tool', async (_, toolData) => {
            if (!toolData?.id) {
                this.windowManager.alertWindow?.show("error", "Tool ID is required.");
                return;
            }
            const config = globals_1.utils.getConfig();
            const plugins = config.plugins || {};
            plugins[toolData.id] = {
                path: toolData.path,
                params: toolData.params,
                extra: toolData.extra,
                enabled: toolData.enabled
            };
            config.plugins = plugins;
            globals_1.utils.setConfig(config);
            this.windowManager.alertWindow?.show("success", "Tool saved successfully!");
        });
        electron_1.ipcMain.handle('delete-tool', async (_, id) => {
            const config = globals_1.utils.getConfig();
            const plugins = config.plugins || {};
            if (plugins[id]) {
                delete plugins[id];
                config.plugins = plugins;
                globals_1.utils.setConfig(config);
                this.windowManager.alertWindow?.show("success", "Tool deleted successfully!");
            }
        });
        electron_1.ipcMain.handle('select-file', async () => {
            return electron_1.dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [{ name: 'JavaScript', extensions: ['js'] }]
            });
        });
    }
}
exports.ToolWindow = ToolWindow;
//# sourceMappingURL=ToolWindow.js.map