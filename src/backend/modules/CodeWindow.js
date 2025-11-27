const { Window } = require("./Window");
const { utils } = require('./globals');

const { BrowserWindow, ipcMain } = require('electron');


class CodeWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
    }

    create() {
        if (this.window) {
            this.window.restore(); // 恢复窗口
            this.window.show();
            this.window.focus();
        } else {
            this.window = new BrowserWindow({
                width: 800,
                height: 600,
                frame: false, // 隐藏默认标题栏和边框
                transparent: true, // 可选：实现透明效果
                resizable: true, // 允许调整窗口大小
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            })

            this.window.loadFile('src/frontend/code.html')
            this.window.on('closed', () => {
                this.window = null;
            })

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

    openFile(filePath) {
        this.create();
        if (this.window.isLoading()) {
            this.window.webContents.once('did-finish-load', () => {
                this.window.webContents.send('open-file', filePath);
            });
        } else {
            this.window.webContents.send('open-file', filePath);
        }
    }

    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    setup() {
        // 读取文件
        ipcMain.handle('get-file', (file_path) => {
            return utils.getFile(file_path);
        });

        // 保存文件
        ipcMain.handle('set-file', (content, file_path) => {
            utils.setFile(content, file_path);
            this.windowManager.alertWindow.show("success","file saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
        });

        // 获取API信息（api_key, api_url）
        ipcMain.handle('get-apis', () => {
            
        });
    }

}

module.exports = {
    CodeWindow
};