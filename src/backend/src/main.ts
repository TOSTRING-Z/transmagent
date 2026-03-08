// 必须在任何其他代码之前引入 source-map-support
import sourceMapSupport from 'source-map-support';
import { logger } from './utils/logger';
import { app } from 'electron';
import { install } from './core/Install';

// 安装 source-map-support（必须在所有其他代码之前）
sourceMapSupport.install({
    hookRequire: true,
    environment: 'node',
    handleUncaughtExceptions: true,
    emptyCacheBetweenOperations: process.env.NODE_ENV === 'development'
});

// 开发环境下增强错误处理
if (process.env.NODE_ENV === 'development') {
    // 增加堆栈跟踪限制
    Error.stackTraceLimit = Infinity;
    
    // 格式化未捕获的异常
    process.on('uncaughtException', (error) => {
        console.error('\n\x1b[31m%s\x1b[0m', '='.repeat(60));
        console.error('\x1b[31m%s\x1b[0m', '未捕获的异常:');
        console.error('\x1b[33m%s\x1b[0m', error.stack);
        console.error('\x1b[31m%s\x1b[0m', '='.repeat(60));
    });
    
    // 格式化未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason, promise) => {
        console.error('\n\x1b[31m%s\x1b[0m', '='.repeat(60));
        console.error('\x1b[31m%s\x1b[0m', '未处理的 Promise 拒绝:');
        console.error('\x1b[33m%s\x1b[0m', reason);
        console.error('\x1b[31m%s\x1b[0m', '='.repeat(60));
    });
}

// 1. 在任何核心模块加载前，确保用户目录的配置文件已就绪
install();

// 2. 引入经过 TS 改造的核心窗口与快捷键管理器
import { WindowManager } from "./main/windows/WindowManager";
// 假设 Shortcut 也已迁移至 src/main 目录，若未迁移可临时使用 require
const { Shortcut } = require('./main/Shortcut'); 

/* App 生命周期管控 */
app.whenReady().then(() => {
    logger.log("[App] Application is ready. Initializing subsystems...");

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