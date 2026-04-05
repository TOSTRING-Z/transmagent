import { BrowserWindow, ipcMain, clipboard } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
export class IconWindow extends BaseWindow {
    public width = 200;
    public height = 40;
    private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create(position?: { x: number; y: number }) {
        if (!position) return;

        const x = position.x;
        const y = position.y > 50 ? position.y - 50 : position.y;
        const autoCloseMs = (this.utils().getConfig("icon_time") || 5) * 1000;

        if (this.window) {
            this.window.setPosition(x, y);
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

        this.window.loadFile('src/frontend/icon.html');
        this.window.setIgnoreMouseEvents(false);
        this.window.on('closed', () => { this.window = null; });

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
        ipcMain.on('concat-clicked', () => {
            WindowManager.instance.mainWindow.concat = true;
            this.destroy();
        });

        ipcMain.on('translation-clicked', () => {
            WindowManager.instance.mainWindow.concat = false;
            const mainWin = this.windowManager.mainWindow;
            mainWin.sendQuery(
                { query: WindowManager.instance.mainWindow.last_clipboard_content || "" },
            );
            this.destroy();
        });

        ipcMain.on('submit-clicked', () => {
            WindowManager.instance.mainWindow.concat = false;
            const mainWin = this.windowManager.mainWindow;
            mainWin.sendQuery(
                { query: WindowManager.instance.mainWindow.last_clipboard_content || "" }
            );
            this.destroy();
        });

        ipcMain.on('clear-clicked', () => {
            WindowManager.instance.mainWindow.concat = false;
            this.destroy();
            WindowManager.instance.mainWindow.last_clipboard_content = "";
            clipboard.writeText("");
        });
    }
}