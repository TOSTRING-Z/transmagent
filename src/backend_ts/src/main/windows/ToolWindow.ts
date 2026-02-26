import { BrowserWindow, ipcMain, dialog } from 'electron';
import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { utils } from '../../utils/globals';

export class ToolWindow extends BaseWindow {
    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create(): void {
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

        this.window.on('closed', () => {
            this.window = null;
        });

        ipcMain.on('minimize-window', () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.minimize();
        });

        ipcMain.on('close-window', () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.close();
        });
    }

    public destroy(): void {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup(): void {
        ipcMain.handle('get-tools', async () => {
            return utils.getConfig("plugins") || {};
        });

        ipcMain.handle('save-tool', async (_event, toolData: any) => {
            if (!toolData?.id) {
                this.windowManager.alertWindow?.show?.("error", "Tool ID is required.");
                return;
            }

            const config = utils.getConfig();
            const plugins = config.plugins || {};

            plugins[toolData.id] = {
                path: toolData.path,
                params: toolData.params,
                extra: toolData.extra,
                enabled: toolData.enabled
            };

            config.plugins = plugins;
            utils.setConfig(config);
            this.windowManager.alertWindow?.show?.("success", "Tool saved successfully!");
        });

        ipcMain.handle('delete-tool', async (_event, id: string) => {
            const config = utils.getConfig();
            const plugins = config.plugins || {};

            if (plugins[id]) {
                delete plugins[id];
                config.plugins = plugins;
                utils.setConfig(config);
                this.windowManager.alertWindow?.show?.("success", "Tool deleted successfully!");
            }
        });

        ipcMain.handle('select-file', async () => {
            return await dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [{ name: 'JavaScript', extensions: ['js'] }]
            });
        });
    }
}