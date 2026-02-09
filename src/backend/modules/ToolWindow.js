const { Window } = require("./Window");
const { utils } = require('./globals');
const { BrowserWindow, ipcMain, dialog } = require('electron');

class ToolWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
    }

    create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
        } else {
            this.window = new BrowserWindow({
                width: 800,
                height: 600,
                frame: false,
                transparent: true,
                resizable: true,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            })

            this.window.loadFile('src/frontend/tool.html')
            this.window.on('closed', () => {
                this.window = null;
            })
            
            // Note: These listeners might stack if opened multiple times without cleanup,
            // mimicking existing pattern in ModelWindow.js
            ipcMain.on('minimize-window', () => {
                const win = BrowserWindow.getFocusedWindow();
                if (win) win.minimize();
            })

            ipcMain.on('close-window', () => {
                const win = BrowserWindow.getFocusedWindow();
                if (win) win.close();
            })
        }
    }

    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    setup() {
        ipcMain.handle('get-tools', async () => {
            const plugins = utils.getConfig("plugins") || {};
            return plugins;
        });

        ipcMain.handle('save-tool', async (event, toolData) => {
            if (!toolData?.id) {
                this.windowManager.alertWindow.show("error", "Tool ID is required.");
                return;
            }
            
            const config = utils.getConfig();
            const plugins = utils.getConfig("plugins") || {};
            
            plugins[toolData.id] = {
                path: toolData.path,
                params: toolData.params,
                extra: toolData.extra,
                enabled: toolData.enabled
            };
            
            config["plugins"] = plugins;
            utils.setConfig(config);
            this.windowManager.alertWindow.show("success", "Tool saved successfully!");
        });

        ipcMain.handle('delete-tool', async (event, id) => {
            const config = utils.getConfig();
            const plugins = utils.getConfig("plugins") || {};
            
            if (plugins[id]) {
                delete plugins[id];
                config["plugins"] = plugins;
                utils.setConfig(config);
                this.windowManager.alertWindow.show("success", "Tool deleted successfully!");
            }
        });

        ipcMain.handle('select-file', async () => {
            const result = await dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [{ name: 'JavaScript', extensions: ['js'] }]
            });
            return result;
        });
    }
}

module.exports = {
    ToolWindow
};