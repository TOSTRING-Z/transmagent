import { BrowserWindow, ipcMain, dialog } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';

export class ToolWindow extends BaseWindow {
    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }

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
        });

        this.window.loadFile('src/frontend/tool.html');
        this.window.on('closed', () => { this.window = null; });
        
        ipcMain.on('minimize-window', () => {
            BrowserWindow.getFocusedWindow()?.minimize()
        })

        ipcMain.on('close-window', () => {
            BrowserWindow.getFocusedWindow()?.close()
        })
    }

    public destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup() {
        ipcMain.handle('get-tools', async () => this.utils().getConfig("plugins") || {});

        ipcMain.handle('save-tool', async (_, toolData) => {
            if (!toolData?.id) {
                this.windowManager.alertWindow?.show("error", "Tool ID is required.");
                return;
            }
            const config = this.utils().getConfig();
            const plugins = config.plugins || {};
            plugins[toolData.id] = toolData;
            config.plugins = plugins;
            this.utils().setConfig(config);
            this.windowManager.alertWindow?.show("success", "Tool saved successfully!");
        });

        ipcMain.handle('delete-tool', async (_, id) => {
            const config = this.utils().getConfig();
            const plugins = config.plugins || {};
            if (plugins[id]) {
                delete plugins[id];
                config.plugins = plugins;
                this.utils().setConfig(config);
                this.windowManager.alertWindow?.show("success", "Tool deleted successfully!");
            }
        });

        ipcMain.handle('select-file', async () => {
            return dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [{ name: 'JavaScript', extensions: ['js'] }]
            });
        });
    }
}