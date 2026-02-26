import { app } from 'electron';
import { install } from './core/Install';

// 1. 在任何核心模块加载前，确保用户目录的配置文件已就绪
install();

// 2. 引入经过 TS 改造的核心窗口与快捷键管理器
import { WindowManager } from "./main/windows/WindowManager";
// 假设 Shortcut 也已迁移至 src/main 目录，若未迁移可临时使用 require
const { Shortcut } = require('./main/Shortcut'); 

/* App 生命周期管控 */
app.whenReady().then(() => {
    console.log("[App] Application is ready. Initializing subsystems...");

    const windowManager = new WindowManager();
    const shortcut = new Shortcut(windowManager);

    // 创建并配置主窗口
    windowManager.mainWindow.create();
    windowManager.mainWindow.setup();
    
    // 配置各辅助窗口的 IPC 和事件总线
    windowManager.iconWindow?.setup();
    windowManager.alertWindow?.setup();
    windowManager.configWindow?.setup();
    windowManager.modelWindow?.setup();
    windowManager.overlayWindow?.setup();
    windowManager.subAgentWindow?.setup();

    // 初始化全局快捷键
    shortcut.init();

    // Mac 系统点击 Dock 栏恢复窗口逻辑
    app.on('activate', () => {
        if (windowManager.mainWindow.window === null) {
            windowManager.mainWindow.create();
            windowManager.mainWindow.setup();
        }
    });
}).catch((error) => {
    console.error("[App] Failed to initialize:", error);
});

// Windows/Linux 环境下全窗口关闭即退出程序
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});