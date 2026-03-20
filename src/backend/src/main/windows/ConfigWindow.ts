import { BrowserWindow, ipcMain } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
import { utils } from '../../utils/globals';

const { Plugins } = require('../../core/Plugins');

export class ConfigWindow extends BaseWindow {
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
        ipcMain.handle('get-config', () => utils.getConfig());

        ipcMain.handle('set-config', (_, config) => {
            let state = utils.setConfig(config);
            this.windowManager.mainWindow.updateVersionsSubmenu();
            const plugins = new Plugins();
            plugins.loadInit();
            this.windowManager.alertWindow?.show("success", "config saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
            return state;
        });
    }
}