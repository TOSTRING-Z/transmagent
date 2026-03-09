import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import * as path from 'path';
import { BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { logger } from '../utils/logger';

// 定义传入参数的接口
export interface PythonExecuteParams {
    python_bin: string;
    threshold?: number;
    show?: boolean;
    delay_time?: number;
}

export interface ExecuteArgs {
    code: string;
}

export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
}

function applyThreshold(data: string, limit?: number): string {
    if (limit && data && data.length > limit) {
        return "Returned content is too large, please try another solution!";
    }
    return data;
}

export function main(params: PythonExecuteParams) {
    return async ({ code }: ExecuteArgs): Promise<string> => {
        // 创建临时文件
        const tempFile = path.join(tmpdir(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.py`);
        writeFileSync(tempFile, code);
        logger.log(`Created temp python file: ${tempFile}`);

        let terminalWindow: BrowserWindow | null = null;
        let child: ChildProcessWithoutNullStreams | null = null;

        // 创建终端窗口
        terminalWindow = new BrowserWindow({
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
            const handleInput = (event: IpcMainEvent, input: string) => {
                if (!input) {
                    child?.stdin.end();
                } else {
                    child?.stdin.write(`${input}`);
                }
            };
            const handleSignal = (event: IpcMainEvent, input: string) => {
                if (input === "ctrl_c") {
                    child?.kill();
                }
            };

            // 挂载 IPC 监听器
            ipcMain.on('minimize-window', handleMinimize);
            ipcMain.on('close-window', handleClose);
            ipcMain.on('terminal-input', handleInput);
            ipcMain.on('terminal-signal', handleSignal);

            // 清理函数：移除所有注册的 IPC 监听器
            let isCleanedUp = false;
            const cleanupListeners = () => {
                if (isCleanedUp) return;
                isCleanedUp = true;

                ipcMain.off('minimize-window', handleMinimize);
                ipcMain.off('close-window', handleClose);
                ipcMain.off('terminal-input', handleInput);
                ipcMain.off('terminal-signal', handleSignal);
            };

            const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
            child = spawn(params.python_bin || 'python', [tempFile], { env });

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            terminalWindow?.webContents.send('terminal-data', `${code}\n`);

            let output = "";
            let errorMsg = "";

            child.stdout.on('data', (data: string) => {
                output += data;
                terminalWindow?.webContents.send('terminal-data', data);
            });

            child.stderr.on('data', (data: string) => {
                errorMsg += data;
                terminalWindow?.webContents.send('terminal-data', data);
            });

            child.on('close', (exitCode) => {
                cleanupListeners(); // 进程结束时清理 IPC 监听器

                if (existsSync(tempFile)) {
                    unlinkSync(tempFile);
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

export function getPrompt() {
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