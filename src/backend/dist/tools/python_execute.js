"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
exports.getPrompt = getPrompt;
const child_process_1 = require("child_process");
const os_1 = require("os");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const electron_1 = require("electron");
const logger_1 = require("../utils/logger");
function applyThreshold(data, limit) {
    if (limit && data && data.length > limit) {
        return "Returned content is too large, please try another solution!";
    }
    return data;
}
function main(params) {
    return async ({ code }) => {
        // 创建临时文件
        const tempFile = path.join((0, os_1.tmpdir)(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.py`);
        (0, fs_1.writeFileSync)(tempFile, code);
        logger_1.logger.log(`Created temp python file: ${tempFile}`);
        let terminalWindow = null;
        let child = null;
        // 创建终端窗口
        terminalWindow = new electron_1.BrowserWindow({
            width: 800,
            height: 600,
            frame: false,
            transparent: true,
            show: false,
            resizable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        terminalWindow.loadFile('src/frontend/terminal.html');
        terminalWindow.once('ready-to-show', () => {
            if (params?.show && terminalWindow) {
                terminalWindow.show();
            }
        });
        return new Promise((resolve) => {
            // 定义具体的 IPC 处理函数，以便后续可以移除它们防止内存泄漏
            const handleMinimize = () => { terminalWindow?.minimize(); };
            const handleClose = () => {
                child?.kill();
                terminalWindow?.close();
            };
            const handleInput = (event, input) => {
                if (!input) {
                    child?.stdin.end();
                }
                else {
                    child?.stdin.write(`${input}`);
                }
            };
            const handleSignal = (event, input) => {
                if (input === "ctrl_c") {
                    child?.kill();
                }
            };
            // 挂载 IPC 监听器
            electron_1.ipcMain.on('minimize-window', handleMinimize);
            electron_1.ipcMain.on('close-window', handleClose);
            electron_1.ipcMain.on('terminal-input', handleInput);
            electron_1.ipcMain.on('terminal-signal', handleSignal);
            // 清理函数：移除所有注册的 IPC 监听器
            let isCleanedUp = false;
            const cleanupListeners = () => {
                if (isCleanedUp)
                    return;
                isCleanedUp = true;
                electron_1.ipcMain.off('minimize-window', handleMinimize);
                electron_1.ipcMain.off('close-window', handleClose);
                electron_1.ipcMain.off('terminal-input', handleInput);
                electron_1.ipcMain.off('terminal-signal', handleSignal);
            };
            const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
            child = (0, child_process_1.spawn)(params.python_bin || 'python', [tempFile], { env });
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            terminalWindow?.webContents.send('terminal-data', `${code}\n`);
            let output = "";
            let errorMsg = "";
            child.stdout.on('data', (data) => {
                output += data;
                terminalWindow?.webContents.send('terminal-data', data);
            });
            child.stderr.on('data', (data) => {
                errorMsg += data;
                terminalWindow?.webContents.send('terminal-data', data);
            });
            child.on('close', (exitCode) => {
                cleanupListeners(); // 进程结束时清理 IPC 监听器
                if ((0, fs_1.existsSync)(tempFile)) {
                    (0, fs_1.unlinkSync)(tempFile);
                }
                const delayMs = (params.delay_time || 0) * 1000;
                setTimeout(() => {
                    if (terminalWindow && !terminalWindow.isDestroyed()) {
                        terminalWindow.close();
                    }
                    resolve(JSON.stringify({
                        success: exitCode === 0,
                        output: applyThreshold(output, params.threshold),
                        error: errorMsg
                    }));
                }, delayMs);
            });
            terminalWindow?.on('closed', () => {
                terminalWindow = null;
                cleanupListeners(); // 确保窗口意外关闭时也能清理
            });
        });
    };
}
function getPrompt() {
    return {
        "name": "python_execute",
        "description": "Execute Python code locally, such as file reading, data analysis, and code execution.",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "(Required) Executable Python code snippet (Python code output must retain \"\\n\" and spaces, please strictly follow the code format, incorrect indentation and line breaks will cause code execution to fail)"
                }
            },
            "required": ["code"]
        }
    };
}
//# sourceMappingURL=python_execute.js.map