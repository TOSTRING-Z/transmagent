const { Window } = require("./Window");
const { utils } = require('./globals');

const { BrowserWindow, ipcMain } = require('electron');
const { screen } = require('electron');

class AlertWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
        this.width = 800;
        this.height = 200;
    }

    show(type, content) {
        const data = { type, content };
        this.create(data);
    }

    create(data) {

        const display = screen.getPrimaryDisplay();
        let x = Math.round((display.workAreaSize.width - this.width) / 2);
        let y = 20;

        if (this.windows) {
            this.windows.setPosition(x, y);
            this.windows.webContents.send('show-log', data);
            if (this.autoCloseTimer) {
                clearTimeout(this.autoCloseTimer);
                this.autoCloseTimer = setTimeout(() => {
                    this.destroy()
                }, utils.getConfig("icon_time") * 1000) // 自动关闭
            }
            return this.windows
        }

        this.windows = new BrowserWindow({
            width: this.width,
            height: this.height,
            x,
            y,
            transparent: true,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            resizable: false,
            focusable: false, // 设置窗口不可聚焦
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        })

        this.windows.loadFile('src/frontend/alert.html')

        this.windows.setIgnoreMouseEvents(false) // 允许鼠标交互

        this.windows.on('closed', () => {
            this.windows = null;
        })

        this.windows.webContents.on('did-finish-load', () => {
            this.windows.webContents.send('show-log', data);
        });

        // 新增自动关闭逻辑
        this.autoCloseTimer = setTimeout(() => {
            this.destroy()
        }, utils.getConfig("icon_time") * 1000) // 自动关闭

        return this.windows
    }

    destroy() {
        if (this.autoCloseTimer) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }
        if (this.windows) {
            this.windows.close();
            this.windows = null;
        }
    }

    setup() {
        ipcMain.on('close-clicked', () => {
            this.destroy();
        })
    }

}

module.exports = {
    AlertWindow
};