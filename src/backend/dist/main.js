"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// 必须在任何其他代码之前引入 source-map-support
const source_map_support_1 = __importDefault(require("source-map-support"));
const logger_1 = require("./utils/logger");
const electron_1 = require("electron");
const Install_1 = require("./core/Install");
// 安装 source-map-support（必须在所有其他代码之前）
source_map_support_1.default.install({
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
(0, Install_1.install)();
// 2. 引入经过 TS 改造的核心窗口与快捷键管理器
const WindowManager_1 = require("./main/windows/WindowManager");
// 假设 Shortcut 也已迁移至 src/main 目录，若未迁移可临时使用 require
const { Shortcut } = require('./main/Shortcut');
/* App 生命周期管控 */
electron_1.app.whenReady().then(() => {
    // 设置应用名称，避免 DevTools 国际化错误 (Intl.Locale constructor can't be empty)
    if (!electron_1.app.name) {
        electron_1.app.name = 'TransMAgent';
    }
    logger_1.logger.log("[App] Application is ready. Initializing subsystems...");
    const windowManager = new WindowManager_1.WindowManager();
    const shortcut = new Shortcut(windowManager);
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
    electron_1.app.on('activate', () => {
        if (windowManager.mainWindow.window === null) {
            windowManager.mainWindow.create();
            windowManager.mainWindow.setup();
        }
    });
}).catch((error) => {
    console.error("[App] Failed to initialize:", error);
});
// Windows/Linux 环境下全窗口关闭即退出程序
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=main.js.map