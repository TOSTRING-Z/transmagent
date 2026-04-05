import { BrowserWindow, ipcMain, screen } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';

export class AlertWindow extends BaseWindow {
    private width = 800;
    private height = 100;
    private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public show(type: string, content: string) {
        this.create({ type, content });
    }

    public create(data?: { type: string; content: string }) {
        const display = screen.getPrimaryDisplay();
        const x = Math.round((display.workAreaSize.width - this.width) / 2);
        const y = 20;
        const autoCloseMs = (WindowManager.instance.mainWindow.session().utils.getConfig("icon_time") || 5) * 1000;

        if (this.window) {
            this.window.setPosition(x, y);
            if (data) this.window.webContents.send('show-log', data);
            this.resetAutoClose(autoCloseMs);
            return;
        }

        this.window = new BrowserWindow({
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
            if (data) this.window?.webContents.send('show-log', data);
        });

        this.resetAutoClose(autoCloseMs);
    }

    private resetAutoClose(ms: number) {
        if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
        this.autoCloseTimer = setTimeout(() => this.destroy(), ms);
    }

    public destroy() {
        if (this.autoCloseTimer) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup() {
        ipcMain.on('close-clicked', () => this.destroy());
    }
}