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
function main(params) {
    return async ({ code }) => {
        const timestamp = Date.now();
        const randomStr = Math.floor(Math.random() * 1000);
        // 创建运行代码的临时文件
        const tempFile = path.join((0, os_1.tmpdir)(), `temp_${timestamp}_${randomStr}.py`);
        (0, fs_1.writeFileSync)(tempFile, code);
        logger_1.logger.log(`Created temp python file: ${tempFile}`);
        // 创建完整输出流式写入的临时文件
        const outputFile = path.join((0, os_1.tmpdir)(), `output_${timestamp}_${randomStr}.txt`);
        const outStream = (0, fs_1.createWriteStream)(outputFile, { encoding: 'utf8', flags: 'a' });
        logger_1.logger.log(`Created temp output log file: ${outputFile}`);
        let terminalWindow = null;
        let child = null;
        let isInterrupted = false; // 用于标记是否被用户主动中断
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
                isInterrupted = true;
                if (child && !child.killed)
                    child.kill();
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
                    isInterrupted = true;
                    if (child && !child.killed)
                        child.kill();
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
            let errorMsg = "";
            let tailBuffer = ""; // 仅保留末尾输出以防止内存溢出(OOM)
            const MAX_TAIL_CHARS = 50000;
            // 提取公共追加逻辑
            const appendToTail = (data) => {
                tailBuffer += data;
                if (tailBuffer.length > MAX_TAIL_CHARS * 2) {
                    tailBuffer = tailBuffer.slice(-MAX_TAIL_CHARS);
                }
            };
            child.stdout.on('data', (data) => {
                outStream.write(data);
                appendToTail(data);
                terminalWindow?.webContents.send('terminal-data', data);
            });
            child.stderr.on('data', (data) => {
                outStream.write(data);
                appendToTail(data);
                errorMsg += data;
                terminalWindow?.webContents.send('terminal-data', data);
            });
            child.on('close', (exitCode) => {
                cleanupListeners(); // 进程结束时清理 IPC 监听器
                outStream.end(); // 关闭文件写入流
                if ((0, fs_1.existsSync)(tempFile)) {
                    (0, fs_1.unlinkSync)(tempFile);
                }
                // 提取最后 N 行 (设定为提取最后 100 行作为摘要)
                const MAX_LINES = 100;
                const lines = tailBuffer.split(/\r?\n/);
                let finalOutput = lines.length > MAX_LINES
                    ? lines.slice(-MAX_LINES).join('\n')
                    : tailBuffer;
                if (isInterrupted) {
                    finalOutput += "\n\n[Process Interrupted by User / 用户主动中断]";
                }
                finalOutput += `\n\n[Complete output saved to / 完整输出已保存至: ${outputFile}]`;
                const delayMs = (params.delay_time || 0) * 1000;
                setTimeout(() => {
                    if (terminalWindow && !terminalWindow.isDestroyed()) {
                        terminalWindow.close();
                    }
                    resolve(JSON.stringify({
                        success: exitCode === 0 && !isInterrupted,
                        output: finalOutput,
                        error: errorMsg
                    }));
                }, delayMs);
            });
            terminalWindow?.on('closed', () => {
                // 如果窗口被用户直接通过UI关闭(如点击X)，且进程还在运行，标记中断并杀进程
                if (child && child.exitCode === null && !child.killed) {
                    isInterrupted = true;
                    child.kill();
                }
                terminalWindow = null;
                cleanupListeners(); // 确保窗口意外关闭时也能清理
            });
        });
    };
}
function getPrompt() {
    return {
        "name": "python_execute",
        "description": "Execute Python code locally. \n[CRITICAL TRIGGER RULES]: \n1. Simple/Single-line commands: Directly pass the executable snippet into the `code` parameter.\n2. Complex/Multi-line commands: DO NOT pass large blocks of code directly. You MUST first write the code into a local `.py` file (in batches if necessary) using file operations, and then use this tool to simply run the generated file (e.g., `import os; os.system('python your_script.py')`).",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "(Required) Executable Python code snippet. Follow the trigger rules strictly to decide whether to execute code directly or execute a pre-written script file."
                }
            },
            "required": ["code"]
        }
    };
}
//# sourceMappingURL=python_execute.js.map