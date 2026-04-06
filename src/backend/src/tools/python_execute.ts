import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync, existsSync, createWriteStream } from 'fs';
import * as path from 'path';
import { BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { logger } from '../utils/logger';
import { ToolCall } from '../core/ToolCall';

// 定义传入参数的接口
export interface PythonExecuteParams {
    python_bin: string;
    threshold?: number;
    show?: boolean;
    delay_time?: number;
}

export interface ExecuteArgs {
    code: string;
    toolCall: ToolCall;
}

export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
}

export function main(params: PythonExecuteParams) {
    return async ({ code }: ExecuteArgs): Promise<string> => {
        const timestamp = Date.now();
        const randomStr = Math.floor(Math.random() * 1000);

        // 创建运行代码的临时文件
        const tempFile = path.join(tmpdir(), `temp_${timestamp}_${randomStr}.py`);
        writeFileSync(tempFile, code);
        logger.log(`Created temp python file: ${tempFile}`);

        // 创建完整输出流式写入的临时文件
        const outputFile = path.join(tmpdir(), `output_${timestamp}_${randomStr}.txt`);
        const outStream = createWriteStream(outputFile, { encoding: 'utf8', flags: 'a' });
        logger.log(`Created temp output log file: ${outputFile}`);

        let terminalWindow: BrowserWindow | null = null;
        let child: ChildProcessWithoutNullStreams | null = null;
        let isInterrupted = false; // 用于标记是否被用户主动中断

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
            let isResolved = false;
            let errorMsg = "";
            let tailBuffer = ""; 
            const MAX_TAIL_CHARS = 50000; 

            // 集中处理结束逻辑，防止由于子进程未响应导致的主进程假死
            const finish = (exitCode: number | null) => {
                if (isResolved) return;
                isResolved = true;

                cleanupListeners(); // 清理 IPC 监听器
                outStream.end(); // 关闭文件写入流

                if (existsSync(tempFile)) {
                    try {
                        unlinkSync(tempFile);
                    } catch (e) {
                        logger.warn(`Failed to delete temp file: ${e}`);
                    }
                }

                // 提取最后 N 行 (设定为提取最后 100 行作为摘要)
                const MAX_LINES = 100;
                const lines = tailBuffer.split(/\r?\n/);
                let finalOutput = lines.length > MAX_LINES 
                    ? lines.slice(-MAX_LINES).join('\n') 
                    : tailBuffer;

                if (isInterrupted) {
                    finalOutput += "\n\n[Process Interrupted by User]";
                }

                finalOutput += `\n\n[Complete output saved to: ${outputFile}]`;

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
            };

            // 定义具体的 IPC 处理函数
            const handleMinimize = () => { terminalWindow?.minimize(); };
            
            const handleClose = () => {
                isInterrupted = true;
                if (child && !child.killed) {
                    child.kill('SIGKILL'); // 强杀，无视进程内部捕获
                }
                finish(null); // 立刻执行结束逻辑，不等 close 事件
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
                    isInterrupted = true;
                    if (child && !child.killed) {
                        child.kill('SIGINT'); // 给进程发送键盘中断信号
                    }
                    
                    // 兜底机制：如果 500ms 后进程还没死 (例如死循环/吞掉了SIGINT)，强杀并结算
                    setTimeout(() => {
                        if (!isResolved) {
                            if (child && !child.killed) child.kill('SIGKILL');
                            finish(null);
                        }
                    }, 500);
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

            // 提取公共追加逻辑
            const appendToTail = (data: string) => {
                tailBuffer += data;
                if (tailBuffer.length > MAX_TAIL_CHARS * 2) {
                    tailBuffer = tailBuffer.slice(-MAX_TAIL_CHARS);
                }
            };

            child.stdout.on('data', (data: string) => {
                outStream.write(data);
                appendToTail(data);
                terminalWindow?.webContents.send('terminal-data', data);
            });

            child.stderr.on('data', (data: string) => {
                outStream.write(data);
                appendToTail(data);
                errorMsg += data;
                terminalWindow?.webContents.send('terminal-data', data);
            });

            // 正常的进程结束周期
            child.on('close', (exitCode) => {
                finish(exitCode); 
            });

            terminalWindow?.on('closed', () => {
                terminalWindow = null;
                // 如果窗口被用户直接通过UI关闭(如点击原生 X 按钮)，强制中断
                if (!isResolved) {
                    isInterrupted = true;
                    if (child && !child.killed) {
                        child.kill('SIGKILL');
                    }
                    finish(null);
                }
            });
        });
    };
}

export function getPrompt() {
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