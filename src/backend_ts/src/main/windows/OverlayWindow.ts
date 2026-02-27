import { BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
import { globalState } from '../../utils/globals';

export class OverlayWindow extends BaseWindow {
    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create() {
        this.window = new BrowserWindow({
            fullscreen: true,
            frame: false,
            transparent: true,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        this.window.loadFile('src/frontend/overlay.html');
        this.window.setAlwaysOnTop(true, 'screen-saver');
        this.window.on('closed', () => { this.window = null; });
    }

    public destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup() {
        ipcMain.handle('app:overlay:get-position', async () => {
            return this.windowManager.iconWindow?.window?.getBounds();
        });

        ipcMain.on('app:overlay:set-position', async (_, { x, y }: { x: number; y: number }) => {
            const iconWin = this.windowManager.iconWindow;
            iconWin?.window?.setBounds({ x, y, width: iconWin.width, height: iconWin.height });
        });

        ipcMain.on('start-capture', () => {
            this.windowManager.iconWindow?.destroy();
            this.create();
        });

        ipcMain.handle('capture-region', async (_, { start, end, dpr }: { start: { x: number; y: number }; end: { x: number; y: number }; dpr: number }) => {
            try {
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                const source = sources.find(s => s.name === 'Entire Screen' || s.name === '整个屏幕');
                return {
                    source,
                    captureRect: {
                        x: Math.min(start.x, end.x) * dpr,
                        y: Math.min(start.y, end.y) * dpr,
                        width: Math.abs(end.x - start.x) * dpr,
                        height: Math.abs(end.y - start.y) * dpr
                    }
                };
            } catch (error: any) {
                throw new Error(`Capture failed: ${error.message}`);
            }
        });

        ipcMain.on('query-img', (_, img_url: string) => {
            const mainWin = this.windowManager.mainWindow;
            mainWin.send_query(
                { img_url },
                mainWin.llm_service.chatManager.chat.model,
                mainWin.llm_service.chatManager.chat.version
            );
            this.destroy();
        });
    }
}