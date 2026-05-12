import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync, existsSync, createWriteStream } from 'fs';
import * as path from 'path';
import { BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { logger } from '../utils/logger';
import { ToolCall } from '../core/ToolCall';
import { isSilentMode } from '../utils/public';
import { BackgroundTaskRegistry } from '../core/BackgroundTaskRegistry';

// 定义传入参数的接口
export interface PythonExecuteParams {
    python_bin: string;
    threshold?: number;
    show?: boolean;
    delay_time?: number;
    background?: boolean;      // 是否后台执行（异步模式，立即返回 task_id）
}

export interface ExecuteArgs {
    code: string;
    toolCall: ToolCall;
    background?: boolean;
}

export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
    task_id?: string; // 后台执行模式返回的任务 ID
}

// --- 后台执行核心逻辑 ---

/**
 * 在后台执行 Python 代码，完成后通过 BackgroundTaskRegistry 投递结果。
 * 不创建终端窗口、不注册 IPC 监听器。
 */
async function runInBackground(
    code: string,
    params: PythonExecuteParams,
    toolCall: ToolCall,
    taskId: string,
    sessionId: string
): Promise<void> {
    const timestamp = Date.now();
    const randomStr = Math.floor(Math.random() * 1000);

    const tempFile = path.join(tmpdir(), `bg_temp_${timestamp}_${randomStr}.py`);
    writeFileSync(tempFile, code);

    const outputFile = path.join(tmpdir(), `bg_output_${timestamp}_${randomStr}.txt`);
    const outStream = createWriteStream(outputFile, { encoding: 'utf8', flags: 'a' });

    // 注册输出文件路径到 Registry
    BackgroundTaskRegistry.setTaskOutputFile(taskId, outputFile);

    let tailBuffer = '';
    let errorBuffer = '';
    const MAX_TAIL_CHARS = 50000;
    let isInterrupted = false;

    const appendToTail = (data: string, isError: boolean = false) => {
        tailBuffer += data;
        if (tailBuffer.length > MAX_TAIL_CHARS * 2) {
            tailBuffer = tailBuffer.slice(-MAX_TAIL_CHARS);
        }
        if (isError) {
            errorBuffer += data;
        }
    };

    return new Promise<void>((_resolve) => {
        let isFinished = false;
        let killProcess: ((force?: boolean) => void) | null = null;

        const sendToRegistry = (exitCode: number | null) => {
            if (isFinished) return;
            isFinished = true;

            BackgroundTaskRegistry.unregisterProcess(taskId);

            outStream.end();
            if (existsSync(tempFile)) {
                try { unlinkSync(tempFile); } catch (e) { /* ignore */ }
            }

            const MAX_LINES = 100;
            const lines = tailBuffer.split(/\r?\n/);
            let finalOutput = lines.length > MAX_LINES
                ? lines.slice(-MAX_LINES).join('\n')
                : tailBuffer;

            if (isInterrupted) {
                finalOutput += '\n\n[Process Interrupted]';
            }

            finalOutput += `\n\n[Complete output saved to: ${outputFile}]`;

            const message = (exitCode === 0 && !isInterrupted)
                ? `✅ Background Python task completed successfully.\n\n**Output:**\n\`\`\`\n${finalOutput}\n\`\`\`` +
                  (errorBuffer ? `\n\n**Stderr:**\n\`\`\`\n${errorBuffer}\n\`\`\`` : '')
                : `❌ Background Python task failed (exit code: ${exitCode}).\n\n**Error:** ${errorBuffer || 'Unknown error'}\n\n**Output:**\n\`\`\`\n${finalOutput}\n\`\`\``;

            BackgroundTaskRegistry.addMessage(sessionId, taskId, message);
            logger.log(`[BackgroundPython] Task "${taskId}" completed, message sent to session "${sessionId}"`);
        };

        const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
        const child = spawn(params.python_bin || 'python', [tempFile], { env });

        killProcess = (force?: boolean) => {
            isInterrupted = true;
            if (child && child.exitCode === null) {
                child.kill(force ? 'SIGKILL' : 'SIGINT');
            }
        };
        BackgroundTaskRegistry.registerProcess(taskId, killProcess);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (data: string) => {
            outStream.write(data);
            appendToTail(data);
        });

        child.stderr.on('data', (data: string) => {
            outStream.write(data);
            appendToTail(data, true);
        });

        child.on('close', (exitCode) => {
            sendToRegistry(exitCode);
        });

        child.on('error', (err) => {
            errorBuffer += `Process error: ${err.message}`;
            sendToRegistry(-1);
        });

        logger.log(`[BackgroundPython] Task "${taskId}" started: ${tempFile}`);
    });
}

export function main(params: PythonExecuteParams) {
    return async ({ code, toolCall, background, action, task_id }: ExecuteArgs & { action?: string; task_id?: string }): Promise<string> => {
        // ── 终止任务分支 ──
        if (action === 'stop') {
            if (!task_id || typeof task_id !== 'string') {
                return JSON.stringify({
                    success: false,
                    output: '',
                    error: 'task_id is required for stop action'
                });
            }
            const ok = BackgroundTaskRegistry.interruptTask(task_id);
            const msg = ok
                ? `Task "${task_id}" has been terminated.`
                : `Failed to terminate task "${task_id}". It may have already completed or does not exist.`;
            logger.log(`[PythonExecute] Stop action: ${msg}`);
            return JSON.stringify({
                success: ok,
                output: msg,
                error: ok ? '' : 'Task not found or already finished.'
            });
        }
        // ── END ──

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

        // ================= 后台执行分支 =================
        if (params.background || background) {
            const taskId = `py_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const sessionId = toolCall.llmService.chatManager.chat.id;

            // 注册后台任务启动生命周期
            BackgroundTaskRegistry.addTaskStart(sessionId, taskId, 'python_execute', code);

            logger.log(`[PythonExecute] Starting background task "${taskId}" for session "${sessionId}"`);
            // 清理同步模式创建的文件，runInBackground 会自行创建
            outStream.end();
            if (existsSync(tempFile)) {
                try { unlinkSync(tempFile); } catch (e) { /* ignore */ }
            }
            if (existsSync(outputFile)) {
                try { unlinkSync(outputFile); } catch (e) { /* ignore */ }
            }
            // 不等待，立即返回；完成后由 runInBackground 回调投递消息
            runInBackground(code, params, toolCall, taskId, sessionId);

            return JSON.stringify({
                success: true,
                output: `Background Python task started. Task ID: ${taskId}`,
                error: '',
                task_id: taskId
            });
        }
        // ================= END 后台执行分支 =================

        let terminalWindow: BrowserWindow | null = null;
        let child: ChildProcessWithoutNullStreams | null = null;
        let isInterrupted = false; // 用于标记是否被用户主动中断

        // 检查静默模式：静默模式下不创建窗口，除非 params.show 为 true
        const silentMode = isSilentMode();
        const shouldShowWindow = params?.show && !silentMode;

        // 仅在需要显示窗口时创建终端窗口
        if (shouldShowWindow) {
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
        } else {
            logger.log('[PythonExecute] Running in silent mode - terminal window hidden');
        }

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

            // 仅在窗口存在时注册 closed 事件
            if (terminalWindow) {
                terminalWindow.on('closed', () => {
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
            }
        });
    };
}

export function getPrompt() {
    return {
        "name": "python_execute",
        "description": "Execute Python code locally, or terminate a running background task. \n\nTASK TERMINATION:\n- Use action='stop' with a task_id to terminate a running background Python task.\n- The task_id is returned when launching a background task (e.g., 'py_1778561347235_h808ly').\n- This sends SIGKILL to the process and marks the task as failed.\n\n[CRITICAL TRIGGER RULES]: \n1. Simple/Single-line commands: Directly pass the executable snippet into the `code` parameter.\n2. Complex/Multi-line commands: DO NOT pass large blocks of code directly. You MUST first write the code into a local `.py` file (in batches if necessary) using file operations, and then use this tool to simply run the generated file (e.g., `import os; os.system('python your_script.py')`).\n\nBACKGROUND EXECUTION:\n- Set 'background' to true for long-running scripts (e.g., training loops, servers).\n- TRIGGER CONDITIONS:\n  1. User explicitly requests background/async execution.\n  2. Script is expected to run >30 seconds (e.g., model training, data processing, web scraping).\n  3. Server/daemon processes that run indefinitely.\n  4. Any script where the agent should NOT block waiting for the result.\n- The tool returns a 'task_id' immediately and runs the script asynchronously.\n- When complete, the result is automatically injected as a user message into the conversation.\n- ⚠️ CRITICAL: After launching a background task, you MUST complete any remaining work and then enter IDLE state. You are STRICTLY FORBIDDEN from looping to poll/check the background task status. The result will be delivered to you automatically.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["execute", "stop"],
                    "description": "Action to perform: 'execute' (default) to run Python code, 'stop' to terminate a running background task by its task_id."
                },
                "code": {
                    "type": "string",
                    "description": "Python code to execute. REQUIRED when action is 'execute' or omitted. Follow the trigger rules strictly to decide whether to execute code directly or execute a pre-written script file."
                },
                "background": {
                    "type": "boolean",
                    "description": "(Optional) If true, runs the script in background and returns a task_id immediately. Only valid when action is 'execute' (or omitted)."
                },
                "task_id": {
                    "type": "string",
                    "description": "The task ID of the background task to stop. REQUIRED when action is 'stop'. The task_id is returned when launching a background task (e.g., 'py_1778561347235_h808ly')."
                }
            }
        }
    };
}