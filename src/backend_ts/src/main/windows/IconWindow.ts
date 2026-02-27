import { BrowserWindow, ipcMain, clipboard } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
import { globalState, utils } from '../../utils/globals';

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
        const autoCloseMs = (utils.getConfig("icon_time") || 5) * 1000;

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
            globalState.concat = true;
            this.destroy();
        });

        ipcMain.on('translation-clicked', () => {
            globalState.concat = false;
            const mainWin = this.windowManager.mainWindow;
            mainWin.send_query(
                { query: globalState.last_clipboard_content || "" },
                "plugins",
                utils.getConfig("default")["plugin"]
            );
            this.destroy();
        });

        ipcMain.on('submit-clicked', () => {
            globalState.concat = false;
            const mainWin = this.windowManager.mainWindow;
            mainWin.send_query(
                { query: globalState.last_clipboard_content || "" },
                mainWin.llm_service.chatManager.chat.model,
                mainWin.llm_service.chatManager.chat.version
            );
            this.destroy();
        });

        ipcMain.on('clear-clicked', () => {
            globalState.concat = false;
            this.destroy();
            globalState.last_clipboard_content = "";
            clipboard.writeText("");
        });
    }
}