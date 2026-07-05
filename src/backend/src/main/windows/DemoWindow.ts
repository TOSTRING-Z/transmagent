import { BrowserWindow, ipcMain } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';

/**
 * DemoWindow - 独立演示模式窗口
 * 加载 frontend/demo.html（包含渲染好的 renderer-demo.js）
 * 该窗口完全前端自治，不调用任何后端 LLM / MCP API
 */
export class DemoWindow extends BaseWindow {
    public width = 1280;
    public height = 820;

    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create() {
        if (this.window) {
            this.window.focus();
            return;
        }

        this.window = new BrowserWindow({
            width: this.width,
            height: this.height,
            minWidth: 960,
            minHeight: 640,
            title: '演示模式 - TransMAgent Demo Mode',
            backgroundColor: '#0f172a',
            autoHideMenuBar: true,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                preload: this.getPreloadPath(),
            },
        });

        // 加载 demo.html（路径相对于 electron 启动时的 cwd，即项目根目录）
        this.window.loadFile('src/frontend/demo.html');

        // 关闭时清理引用
        this.window.on('closed', () => {
            this.window = null;
        });
    }

    public destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup() {
        // 演示窗口就绪事件（保留扩展点）
        ipcMain.on('demo-window-ready', () => {
            // 可用于后续状态同步
        });

        // 主窗口 → 演示窗口：推送当前会话历史
        // 由 MainWindow 在 open-demo-window 之后调用，
        // payload: { title: string, scenario: string, messages: Array<{role,content,info?}> }
        ipcMain.on('send-demo-data', (_event, payload) => {
            if (this.window && !this.window.isDestroyed()) {
                this.window.webContents.send('demo-data', payload);
            }
        });
    }

    private getPreloadPath(): string {
        // 使用编译后的 preload；保持与项目其他 preload 一致的命名约定
        // 真实路径由打包流程生成；这里仅做占位
        return '';
    }
}