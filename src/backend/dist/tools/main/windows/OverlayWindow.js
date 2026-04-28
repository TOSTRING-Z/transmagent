"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OverlayWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
class OverlayWindow extends BaseWindow_1.BaseWindow {
    constructor(windowManager) {
        super(windowManager);
    }
    create() {
        this.window = new electron_1.BrowserWindow({
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
    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }
    setup() {
        electron_1.ipcMain.handle('app:overlay:get-position', async () => {
            return this.windowManager.iconWindow?.window?.getBounds();
        });
        electron_1.ipcMain.on('app:overlay:set-position', async (_, { x, y }) => {
            const iconWin = this.windowManager.iconWindow;
            iconWin?.window?.setBounds({ x, y, width: iconWin.width, height: iconWin.height });
        });
        electron_1.ipcMain.on('start-capture', () => {
            this.windowManager.iconWindow?.destroy();
            this.create();
        });
        electron_1.ipcMain.handle('capture-region', async (_, { start, end, dpr }) => {
            try {
                const sources = await electron_1.desktopCapturer.getSources({ types: ['screen'] });
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
            }
            catch (error) {
                throw new Error(`Capture failed: ${error.message}`);
            }
        });
        electron_1.ipcMain.on('query-img', (_, img_url) => {
            const mainWin = this.windowManager.mainWindow;
            mainWin.sendQuery({ img_url });
            this.destroy();
        });
    }
}
exports.OverlayWindow = OverlayWindow;
