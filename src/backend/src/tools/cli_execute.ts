import { exec, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { Client, ClientChannel } from 'ssh2';
import { logger } from '../utils/logger';
import { LLMAssistant } from '../core/LLMAssistant';
import { ToolCall } from '../core/ToolCall';
import { isSilentMode } from '../utils/public';
import { BackgroundTaskRegistry } from '../core/BackgroundTaskRegistry';

// --- 类型定义 ---
export interface CliExecuteParams {
    timeout?: number;
    delay_time?: number;
    max_lines?: number;
    max_chars_per_line?: number;
    bashrc?: string;
    show?: boolean;
    bash?: string;
    monitor_interval?: number; // 控制台监测间隔（分钟），默认10
    background?: boolean;      // 是否后台执行（异步模式，立即返回 task_id）
}

export interface ExecuteArgs {
    code: string;
    timeout?: number;
    toolCall: ToolCall;
    background?: boolean;
}

export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
    timeout?: boolean;
    message?: string;
    task_id?: string; // 后台执行模式返回的任务 ID
}

// --- 辅助函数 ---
function threshold(data: string, max_lines = 40, max_chars_per_line = 200): { result: string, isTruncated: boolean } {
    if (!data) return { result: data, isTruncated: false };

    let lines = data.split('\n');
    let result = '';
    let isTruncated = false;

    if (lines.length > max_lines) {
        result += `[truncated because the output is too long, showing only last ${max_lines} lines (max ${max_chars_per_line} chars per line)]\n`;
        lines = lines.slice(-max_lines);
        isTruncated = true;
    }

    lines.forEach(line => {
        if (line.length > max_chars_per_line) {
            result += line.substring(0, max_chars_per_line) + '...\n';
            isTruncated = true;
        } else {
            result += line + '\n';
        }
    });

    return { result: result.trim(), isTruncated };
}

function validateParams(params: CliExecuteParams | undefined): Required<CliExecuteParams> {
    if (!params) {
        throw new Error('Parameters are required');
    }

    const validated: Required<CliExecuteParams> = {
        timeout: (typeof params.timeout === 'number' && params.timeout >= 6000) ? params.timeout : 6000,
        delay_time: (typeof params.delay_time === 'number' && params.delay_time >= 2) ? params.delay_time : 2,
        max_lines: (typeof params.max_lines === 'number' && params.max_lines >= 10) ? params.max_lines : 10,
        max_chars_per_line: (typeof params.max_chars_per_line === 'number' && params.max_chars_per_line >= 100) ? params.max_chars_per_line : 100,
        bashrc: params.bashrc || '',
        show: !!params.show,
        bash: params.bash || 'bash',
        monitor_interval: (typeof params.monitor_interval === 'number' && params.monitor_interval >= 1) ? params.monitor_interval : 10,
        background: !!params.background
    };

    return validated;
}

function cleanupResources(tempFile: string, terminalWindow: BrowserWindow | null, conn: Client | null = null) {
    try {
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    } catch (error: any) {
        logger.warn(`Failed to delete temp file: ${error.message}`);
    }

    if (terminalWindow && !terminalWindow.isDestroyed()) {
        terminalWindow.close();
    }

    if (conn) {
        try {
            conn.end();
        } catch (error: any) {
            logger.warn(`Failed to close SSH connection: ${error.message}`);
        }
    }
}

// --- 后台执行核心逻辑 ---

/**
 * 在后台执行命令，完成后通过 BackgroundTaskRegistry 将结果投递到会话消息队列。
 * 不创建终端窗口、不注册 IPC 监听器。
 */
async function runInBackground(
    code: string,
    params: Required<CliExecuteParams>,
    toolCall: ToolCall,
    taskId: string,
    sessionId: string
): Promise<void> {
    let finalCode = code;
    if (params.bashrc) {
        finalCode = `source ${params.bashrc};\n${code}`;
    }

    const timestamp = Date.now();
    const randomStr = Math.floor(Math.random() * 1000);
    let outStream: any = null;
    let finalOutputFilePath = '';
    let localTempScriptFile = '';

    // 输出缓冲区
    let tailBuffer = '';
    let errorBuffer = '';
    const MAX_TAIL_CHARS = 50000;
    let isTailTruncated = false;
    let isErrorTruncated = false;
    let isInterrupted = false;

    const appendData = (data: string, isError: boolean = false) => {
        if (outStream) {
            try { outStream.write(data); } catch (e: any) { /* ignore */ }
        }
        tailBuffer += data;
        if (tailBuffer.length > MAX_TAIL_CHARS) {
            tailBuffer = tailBuffer.slice(-MAX_TAIL_CHARS);
            isTailTruncated = true;
        }
        if (isError) {
            errorBuffer += data;
            if (errorBuffer.length > MAX_TAIL_CHARS) {
                errorBuffer = errorBuffer.slice(-MAX_TAIL_CHARS);
                isErrorTruncated = true;
            }
        }
    };

    return new Promise<void>((_resolve) => {
        let isFinished = false;
        let timeoutId: NodeJS.Timeout | null = null;
        let killProcess: ((force?: boolean) => void) | null = null;
        let conn: Client | null = null;

        const sendToRegistry = (result: Partial<ExecuteResult>) => {
            if (isFinished) return;
            isFinished = true;

            BackgroundTaskRegistry.unregisterProcess(taskId);

            if (timeoutId) clearTimeout(timeoutId);
            if (outStream) {
                try { outStream.end(); } catch (e) { /* ignore */ }
            }

            if (localTempScriptFile && fs.existsSync(localTempScriptFile)) {
                try { fs.unlinkSync(localTempScriptFile); } catch (e: any) { /* ignore */ }
            }
            if (conn) {
                try { conn.end(); } catch (e: any) { /* ignore */ }
            }

            const outThreshold = threshold(tailBuffer, params.max_lines, params.max_chars_per_line);
            const errThreshold = threshold(errorBuffer, params.max_lines, params.max_chars_per_line);
            let finalOutput = outThreshold.result;
            const finalError = errThreshold.result;

            if (isInterrupted) {
                finalOutput += '\n\n[Process Interrupted]';
            } else if (result.timeout) {
                finalOutput += '\n\n[Process Timed Out]';
            }

            const hasTruncation = isTailTruncated || isErrorTruncated ||
                outThreshold.isTruncated || errThreshold.isTruncated;

            if (hasTruncation && finalOutputFilePath) {
                finalOutput += `\n\n[Complete output saved to: ${finalOutputFilePath}]`;
            }

            const message = result.success
                ? `✅ Background task completed successfully.\n\n**Output:**\n\`\`\`\n${finalOutput}\n\`\`\`` +
                  (finalError ? `\n\n**Stderr:**\n\`\`\`\n${finalError}\n\`\`\`` : '')
                : `❌ Background task failed.\n\n**Error:** ${result.error || finalError || 'Unknown error'}\n\n**Output:**\n\`\`\`\n${finalOutput}\n\`\`\``;

            BackgroundTaskRegistry.addMessage(sessionId, taskId, message);
            logger.log(`[BackgroundTask] Task "${taskId}" completed, message sent to session "${sessionId}"`);
        };

        // 超时处理
        timeoutId = setTimeout(() => {
            logger.log(`[BackgroundTask] Task "${taskId}" timed out after ${params.timeout}s`);
            if (killProcess) killProcess(true);
            sendToRegistry({
                success: false,
                timeout: true,
                message: `Command execution timed out after ${params.timeout} seconds`,
                error: 'Execution timed out'
            });
        }, params.timeout * 1000);

        const sshConfig = toolCall.utils.getSshConfig();

        if (sshConfig?.enabled) {
            // =========== 远程 SSH 后台执行 ===========
            conn = new Client();

            conn.on('ready', () => {
                logger.log(`[BackgroundTask] SSH connected for task "${taskId}"`);
                conn!.sftp((sftpErr, sftp) => {
                    if (sftpErr) {
                        return sendToRegistry({ success: false, error: `SFTP error: ${sftpErr.message}` });
                    }

                    finalOutputFilePath = `/tmp/bg_output_${timestamp}_${randomStr}.txt`;
                    outStream = sftp.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });

                    // 注册输出文件路径到 Registry
                    BackgroundTaskRegistry.setTaskOutputFile(taskId, finalOutputFilePath);
                    outStream.on('error', (err: Error) => {
                        logger.warn(`[BackgroundTask] Remote stream error: ${err.message}`);
                    });

                    const remoteScriptPath = `/tmp/bg_script_${timestamp}_${randomStr}.sh`;
                    const writeStream = sftp.createWriteStream(remoteScriptPath);
                    writeStream.on('error', (writeErr: Error) => {
                        sendToRegistry({ success: false, error: `File upload error: ${writeErr.message}` });
                    });

                    writeStream.write(`#!/bin/bash\n${finalCode}`);
                    writeStream.end();

                    writeStream.on('close', () => {
                        conn!.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream: ClientChannel) => {
                            if (execErr) {
                                return sendToRegistry({ success: false, error: `Execution error: ${execErr.message}` });
                            }

                            killProcess = (force?: boolean) => {
                                isInterrupted = true;
                                try { stream.close(); } catch (e) { /* ignore */ }
                                if (force && conn) {
                                    try { conn.end(); } catch (e) { /* ignore */ }
                                }
                            };

                            BackgroundTaskRegistry.registerProcess(taskId, killProcess);

                            stream.on('close', (exitCode: number) => {
                                sendToRegistry({ success: exitCode === 0 && !isInterrupted });
                            });

                            stream.on('data', (data: Buffer) => {
                                appendData(data.toString(), false);
                            });

                            stream.stderr.on('data', (data: Buffer) => {
                                appendData(data.toString(), true);
                            });
                        });
                    });
                });
            });

            conn.on('error', (err: Error) => {
                sendToRegistry({ success: false, error: `SSH connection failed: ${err.message}` });
            });

            try {
                conn.connect(sshConfig);
            } catch (connectErr: any) {
                sendToRegistry({ success: false, error: `SSH connection failed: ${connectErr.message}` });
            }
        } else {
            // =========== 本地后台执行 ===========
            finalOutputFilePath = path.join(os.tmpdir(), `bg_output_${timestamp}_${randomStr}.txt`);
            localTempScriptFile = path.join(os.tmpdir(), `bg_temp_${timestamp}_${randomStr}.sh`);

            // 注册输出文件路径到 Registry
            BackgroundTaskRegistry.setTaskOutputFile(taskId, finalOutputFilePath);

            try {
                outStream = fs.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                outStream.on('error', (err: Error) => {
                    if (!isFinished) logger.warn(`[BackgroundTask] Local stream error: ${err.message}`);
                });
                fs.writeFileSync(localTempScriptFile, finalCode);
                logger.log(`[BackgroundTask] Task "${taskId}" started, script: ${localTempScriptFile}`);
            } catch (error: any) {
                return sendToRegistry({ success: false, error: `Failed to create local files: ${error.message}` });
            }

            const child: ChildProcess = exec(`${params.bash} ${localTempScriptFile}`);

            killProcess = (force?: boolean) => {
                isInterrupted = true;
                if (child && child.exitCode === null) {
                    child.kill(force ? 'SIGKILL' : 'SIGINT');
                }
            };

            BackgroundTaskRegistry.registerProcess(taskId, killProcess);

            child.on('error', (childErr: Error) => {
                sendToRegistry({ success: false, error: `Process execution failed: ${childErr.message}` });
            });

            child.stdout?.on('data', (data: Buffer | string) => {
                appendData(data.toString(), false);
            });

            child.stderr?.on('data', (data: Buffer | string) => {
                appendData(data.toString(), true);
            });

            child.on('close', (exitCode: number | null) => {
                sendToRegistry({ success: exitCode === 0 && !isInterrupted });
            });
        }
    });
}

// --- 主执行逻辑 ---
export function main(initialParams: CliExecuteParams = {}) {
    return async ({ code, timeout, toolCall, background, action, task_id }: ExecuteArgs & { action?: string; task_id?: string }): Promise<ExecuteResult> => {
        // ── 终止任务分支 ──
        if (action === 'stop') {
            if (!task_id || typeof task_id !== 'string') {
                return { success: false, output: '', error: 'task_id is required for stop action' };
            }
            const ok = BackgroundTaskRegistry.interruptTask(task_id);
            const msg = ok
                ? `Task "${task_id}" has been terminated.`
                : `Failed to terminate task "${task_id}". It may have already completed or does not exist.`;
            logger.log(`[CliExecute] Stop action: ${msg}`);
            return {
                success: ok,
                output: msg,
                error: ok ? '' : 'Task not found or already finished.'
            } as any;
        }
        // ── END ──

        let params: Required<CliExecuteParams>;

        try {
            params = validateParams(initialParams);
        } catch (error: any) {
            return { success: false, output: '', error: error.message };
        }

        if (!code || typeof code !== 'string') {
            return { success: false, output: '', error: 'Valid code parameter is required' };
        }

        // ================= 拦截逻辑 START =================
        const MAX_DIRECT_CODE_LENGTH = 500;
        if (code.length > MAX_DIRECT_CODE_LENGTH) {
            const errorMsg = `Execution blocked: Command is too long (${code.length} chars). ` +
                `Max allowed is ${MAX_DIRECT_CODE_LENGTH}. ` +
                `ACTION REQUIRED: Please use the 'write_to_file' tool to save this script to a temporary file (e.g., /tmp/task.sh) first, ` +
                `then use 'cli_execute' with a short command like 'bash /tmp/task.sh' to run it.`;
            logger.warn(errorMsg);
            return { success: false, output: '', error: errorMsg };
        }

        if (code.split('\n').length > 5 || (/[|>]/.test(code) && code.length > 200)) {
            logger.warn(`[CliExecute] Warning: Executing potentially complex multi-line command directly.`);
        }
        // ================= 拦截逻辑 END =================

        if (typeof timeout === 'number' && timeout > params.timeout) {
            params.timeout = timeout;
        }

        const timestamp = Date.now();
        const randomStr = Math.floor(Math.random() * 1000);
        let finalCode = code;
        if (params.bashrc) {
            finalCode = `source ${params.bashrc};\n${code}`;
        }

        // ================= 后台执行分支 =================
        if (params.background || background) {
            const taskId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const sessionId = toolCall.llmService.chatManager.chat.id;

            // 注册后台任务启动生命周期
            BackgroundTaskRegistry.addTaskStart(sessionId, taskId, 'cli_execute', code);

            logger.log(`[CliExecute] Starting background task "${taskId}" for session "${sessionId}"`);
            // 不等待，立即返回；完成后由 runInBackground 回调投递消息
            runInBackground(finalCode, params, toolCall, taskId, sessionId);

            return {
                success: true,
                output: `Background task started. Task ID: ${taskId}`,
                task_id: taskId
            } as any;
        }
        // ================= END 后台执行分支 =================

        // 检查静默模式：静默模式下不创建窗口，除非 params.show 为 true
        const silentMode = isSilentMode();
        const shouldShowWindow = params.show && !silentMode;

        let terminalWindow: BrowserWindow | null = null;
        try {
            // 仅在需要显示窗口时创建终端窗口
            if (shouldShowWindow) {
                terminalWindow = new BrowserWindow({
                    width: 800,
                    height: 600,
                    frame: false,
                    transparent: true,
                    resizable: true,
                    show: false,
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false
                    }
                });

                terminalWindow.loadFile('src/frontend/terminal.html');

                terminalWindow.once('ready-to-show', () => {
                    if (params.show && terminalWindow && !terminalWindow.isDestroyed()) {
                        terminalWindow.show();
                    }
                });
            } else {
                logger.log('[CliExecute] Running in silent mode - terminal window hidden');
            }
        } catch (error: any) {
            return { success: false, output: '', error: `Failed to create terminal window: ${error.message}` };
        }

        return new Promise((resolve) => {
            let timeoutId: NodeJS.Timeout | null = null;
            let isResolved = false;
            let conn: Client | null = null;
            let isInterrupted = false;

            // 用于保存底层的强杀方法，屏蔽本地和远程差异
            let killProcess: ((force?: boolean) => void) | null = null;

            // 依据执行环境动态分配：输出流及路径
            let outStream: any = null; 
            let finalOutputFilePath = ""; 
            let localTempScriptFile = ""; 

            // 用于保存最后的输出内容（防止内存泄漏）
            let tailBuffer = "";
            let errorBuffer = "";
            const MAX_TAIL_CHARS = 50000;
            
            // 记录底层 Buffer 是否被截断
            let isTailTruncated = false;
            let isErrorTruncated = false;
            
            // 用于 ConsoleMonitor 增量检查的缓冲区
            let monitorBuffer = ""; 

            const appendData = (data: string, isError: boolean = false) => {
                if (outStream) {
                    try {
                        outStream.write(data);
                    } catch (e: any) {
                        logger.warn(`Failed to write to stream: ${e.message}`);
                    }
                }
                
                tailBuffer += data;
                if (tailBuffer.length > MAX_TAIL_CHARS) {
                    tailBuffer = tailBuffer.slice(-MAX_TAIL_CHARS);
                    isTailTruncated = true; // 触发底层截断
                }

                monitorBuffer += data;

                if (isError) {
                    errorBuffer += data;
                    if (errorBuffer.length > MAX_TAIL_CHARS) {
                        errorBuffer = errorBuffer.slice(-MAX_TAIL_CHARS);
                        isErrorTruncated = true; // 触发底层截断
                    }
                }
            };

            const finish = (result: Partial<ExecuteResult>) => {
                if (isResolved) return;
                isResolved = true;

                if (monitorIntervalId) {
                    clearInterval(monitorIntervalId);
                    monitorIntervalId = null;
                }

                if (timeoutId) clearTimeout(timeoutId);
                if (outStream) {
                    try {
                        outStream.end();
                    } catch (e) {}
                }

                // 清理所有主进程事件监听器
                ipcMain.off('minimize-window', handleMinimize);
                ipcMain.removeListener('close-window', handleCloseWindow);
                if (inputHandler) ipcMain.off('terminal-input', inputHandler);
                if (signalHandler) ipcMain.off('terminal-signal', signalHandler);

                cleanupResources(localTempScriptFile, terminalWindow, conn);

                // 获取并检查是否在格式化阶段被截断
                const outThreshold = threshold(tailBuffer, params.max_lines, params.max_chars_per_line);
                const errThreshold = threshold(errorBuffer, params.max_lines, params.max_chars_per_line);
                
                let finalOutput = outThreshold.result;
                const finalError = errThreshold.result;
                
                if (isInterrupted) {
                    finalOutput += "\n\n[Process Interrupted by User]";
                } else if (result.timeout) {
                    finalOutput += "\n\n[Process Timed Out]";
                }

                // 判断是否在任何环节发生了截断
                const hasTruncation = isTailTruncated || isErrorTruncated || outThreshold.isTruncated || errThreshold.isTruncated;

                // 仅当发生了截断，且拥有日志文件路径时，才追加提示
                if (hasTruncation && finalOutputFilePath) {
                    finalOutput += `\n\n[Complete output saved to: ${finalOutputFilePath}]`;
                }

                resolve({
                    success: result.success ?? false,
                    output: finalOutput,
                    error: finalError,
                    timeout: result.timeout,
                    message: result.message
                });
            };

            const handleMinimize = () => { terminalWindow?.minimize(); };
            const handleCloseWindow = () => {
                isInterrupted = true;
                if (killProcess) killProcess(true); // 强杀底层进程
                finish({
                    success: false,
                    error: 'Execution cancelled by user'
                });
            };

            ipcMain.on('minimize-window', handleMinimize);
            ipcMain.once('close-window', handleCloseWindow);

            // 监听窗口被原生 X 按钮关闭的情况
            if (terminalWindow) {
                terminalWindow.on('closed', () => {
                    terminalWindow = null;
                    if (!isResolved) {
                        isInterrupted = true;
                        if (killProcess) killProcess(true);
                        finish({ success: false, error: 'Terminal window closed by user' });
                    }
                });
            }

            // ================= 控制台输出循环监测逻辑 =================
            let llmAssistant: LLMAssistant = toolCall.llmAssistant;
            let monitorIntervalId: NodeJS.Timeout | null = null;
            const executionStartTime = Date.now();

            const monitorIntervalMinutes = initialParams?.monitor_interval ?? 10;
            const MONITOR_INTERVAL_MS = monitorIntervalMinutes * 60 * 1000;

            const startConsoleMonitor = async (): Promise<boolean> => {
                try {
                    // 消费并清空增量缓冲区，防止内存膨胀
                    const newOutput = monitorBuffer;
                    monitorBuffer = ""; 

                    if (newOutput.trim().length === 0) return false;

                    const executionTimeMs = Date.now() - executionStartTime;
                    logger.log(`[ConsoleMonitor] Checking output (${newOutput.length} chars, elapsed: ${Math.round(executionTimeMs / 1000)}s)...`);

                    const checkResult = await llmAssistant.checkConsoleOutput(newOutput, executionTimeMs);

                    if (checkResult.shouldInterrupt) {
                        logger.warn(`[ConsoleMonitor] INTERRUPT: ${checkResult.reason}`);
                        isInterrupted = true;
                        if (killProcess) killProcess(true);
                        finish({
                            success: false,
                            error: `[INTERRUPTED BY CONSOLE MONITOR]\nReason: ${checkResult.reason}`,
                            message: 'Execution interrupted due to detected risky operations'
                        });
                        return true;
                    }
                } catch (checkError) {
                    logger.warn(`[ConsoleMonitor] Check error: ${checkError}`);
                }
                return false;
            };

            monitorIntervalId = setInterval(async () => {
                const interrupted = await startConsoleMonitor();
                if (interrupted && monitorIntervalId) {
                    clearInterval(monitorIntervalId);
                    monitorIntervalId = null;
                }
            }, MONITOR_INTERVAL_MS);
            // ================= END 监测逻辑 =================

            timeoutId = setTimeout(() => {
                logger.log(`Command execution timed out after ${params.timeout} seconds`);
                if (killProcess) killProcess(true);
                finish({
                    success: false,
                    timeout: true,
                    message: `Command execution timed out after ${params.timeout} seconds, but returning current console output`
                });
            }, params.timeout * 1000);

            const sshConfig = toolCall.utils.getSshConfig();
            let inputHandler: ((event: IpcMainEvent, input: string) => void) | null = null;
            let signalHandler: ((event: IpcMainEvent, signal: string) => void) | null = null;

            if (sshConfig?.enabled) {
                // ================= 远程 SSH 执行模式 =================
                conn = new Client();

                conn.on('ready', () => {
                    logger.log('SSH Connection Ready');
                    
                    conn!.sftp((sftpErr, sftp) => {
                        if (sftpErr) {
                            return finish({ success: false, error: `SFTP error: ${sftpErr.message}` });
                        }

                        // 1. 设置远程输出日志文件流
                        finalOutputFilePath = `/tmp/output_${timestamp}_${randomStr}.txt`;
                        outStream = sftp.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                        outStream.on('error', (err: Error) => {
                            if (!isResolved) {
                                logger.warn(`Remote output stream error: ${err.message}`);
                            }
                        });
                        logger.log(`Remote output file created: ${finalOutputFilePath}`);

                        // 2. 写入并上传执行脚本到远程
                        const remoteScriptPath = `/tmp/bash_script_${timestamp}_${randomStr}.sh`;
                        const writeStream = sftp.createWriteStream(remoteScriptPath);
                        writeStream.on('error', (writeErr: Error) => {
                            finish({ success: false, error: `File upload error: ${writeErr.message}` });
                        });

                        writeStream.write(`#!/bin/bash\n${finalCode}`);
                        writeStream.end();

                        // 3. 执行远程脚本
                        writeStream.on('close', () => {
                            conn!.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream: ClientChannel) => {
                                if (execErr) {
                                    return finish({ success: false, error: `Execution error: ${execErr.message}` });
                                }

                                killProcess = (force?: boolean) => {
                                    if (stream) {
                                        try { stream.close(); } catch(e) {}
                                    }
                                    if (force && conn) {
                                        try { conn.end(); } catch(e) {}
                                    }
                                };

                                terminalWindow?.webContents.send('terminal-data', `${code}\n`);

                                stream.on('close', (exitCode: number, signalName: string) => {
                                    logger.log(`Command completed: exit code ${exitCode}, signal ${signalName}`);
                                    finish({ success: exitCode === 0 && !isInterrupted });
                                });

                                stream.on('data', (data: Buffer) => {
                                    const str = data.toString();
                                    appendData(str, false);
                                    terminalWindow?.webContents.send('terminal-data', str);
                                });

                                stream.stderr.on('data', (data: Buffer) => {
                                    const str = data.toString();
                                    appendData(str, true);
                                    terminalWindow?.webContents.send('terminal-data', str);
                                });

                                inputHandler = (event, input) => {
                                    if (!input) stream.end();
                                    else stream.write(input);
                                };

                                signalHandler = (event, signal) => {
                                    if (signal === "ctrl_c") {
                                        isInterrupted = true;
                                        if (killProcess) killProcess(false);
                                        
                                        setTimeout(() => {
                                            if (!isResolved) {
                                                if (killProcess) killProcess(true);
                                                finish({ success: false });
                                            }
                                        }, 500);
                                    }
                                };

                                ipcMain.on('terminal-input', inputHandler);
                                ipcMain.on('terminal-signal', signalHandler);
                            });
                        });
                    });
                });

                conn.on('error', (err: Error) => {
                    finish({ success: false, error: `SSH connection failed: ${err.message}` });
                });

                try {
                    conn.connect(sshConfig);
                } catch (connectErr: any) {
                    finish({ success: false, error: `SSH connection failed: ${connectErr.message}` });
                }

            } else {
                // ================= 本地执行模式 =================
                finalOutputFilePath = path.join(os.tmpdir(), `output_${timestamp}_${randomStr}.txt`);
                localTempScriptFile = path.join(os.tmpdir(), `temp_${timestamp}_${randomStr}.sh`);

                try {
                    // 1. 设置本地输出日志文件流
                    outStream = fs.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                    outStream.on('error', (err: Error) => {
                        if (!isResolved) {
                            logger.warn(`Local output stream error: ${err.message}`);
                        }
                    });
                    logger.log(`Local output file created: ${finalOutputFilePath}`);

                    // 2. 写入本地执行脚本
                    fs.writeFileSync(localTempScriptFile, finalCode);
                    logger.log(`Temporary script file created: ${localTempScriptFile}`);
                } catch (error: any) {
                    return finish({ success: false, error: `Failed to create local files: ${error.message}` });
                }

                // 3. 运行本地脚本
                const child: ChildProcess = exec(`${params.bash} ${localTempScriptFile}`);

                killProcess = (force?: boolean) => {
                    if (child && child.exitCode === null) {
                        child.kill(force ? 'SIGKILL' : 'SIGINT');
                    }
                };

                child.on('error', (childErr: Error) => {
                    finish({ success: false, error: `Process execution failed: ${childErr.message}` });
                });

                child.stdout?.on('data', (data: Buffer | string) => {
                    const str = data.toString();
                    appendData(str, false);
                    terminalWindow?.webContents.send('terminal-data', str);
                });

                child.stderr?.on('data', (data: Buffer | string) => {
                    const str = data.toString();
                    appendData(str, true);
                    terminalWindow?.webContents.send('terminal-data', str);
                });

                child.on('close', (exitCode: number | null) => {
                    finish({ success: exitCode === 0 && !isInterrupted });
                });

                inputHandler = (event, input) => {
                    if (!input) child.stdin?.end();
                    else child.stdin?.write(input);
                };

                signalHandler = (event, signal) => {
                    if (signal === "ctrl_c") {
                        isInterrupted = true;
                        if (killProcess) killProcess(false);
                        
                        setTimeout(() => {
                            if (!isResolved) {
                                if (killProcess) killProcess(true);
                                finish({ success: false });
                            }
                        }, 500);
                    }
                };

                ipcMain.on('terminal-input', inputHandler);
                ipcMain.on('terminal-signal', signalHandler);
            }
        });
    };
}

export function getPrompt() {
    return {
        "name": "cli_execute",
        "description": `A command-line tool for executing bash commands, or terminating a running background task.

TASK TERMINATION:
- Use action='stop' with a task_id to terminate a running background CLI task.
- The task_id is returned when launching a background task (e.g., 'bg_1778561347235_h808ly').
- This sends SIGKILL to the process and marks the task as failed.
        
CRITICAL LIMITATION: 
This tool CANNOT execute scripts longer than 500 characters. 

EXECUTION PIPELINE:
- For short, simple commands (e.g., 'ls -la', 'mkdir test'): Pass the command directly into 'code'.
- For complex or long multi-line scripts: 
  1. DO NOT pass the script into 'code'.
  2. Use the 'write_to_file' tool FIRST to save your script to a file (e.g., '/tmp/script.sh').
  3. Then, use this 'cli_execute' tool to run the file (e.g., pass 'bash /tmp/script.sh' into 'code').

BACKGROUND EXECUTION:
- Set 'background' to true for long-running commands (e.g., training loops, servers, watchers, long installations).
- TRIGGER CONDITIONS:
  1. User explicitly requests background/async execution.
  2. Command is expected to run >30 seconds (e.g., npm install, pip install, model training).
  3. Server/daemon processes that run indefinitely.
  4. Any command where the agent should NOT block waiting for the result.
- The tool returns a 'task_id' immediately and runs the command asynchronously.
- When complete, the result is automatically injected as a user message into the conversation.
- ⚠️ CRITICAL: After launching a background task, you MUST complete any remaining work and then enter IDLE state. You are STRICTLY FORBIDDEN from looping to poll/check the background task status. The result will be delivered to you automatically.

If your execution fails due to a bug in a long script, use 'replace_in_file' to patch the file, then run 'cli_execute' again.`,
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["execute", "stop"],
                    "description": "Action to perform: 'execute' (default) to run a bash command, 'stop' to terminate a running background task by its task_id."
                },
                "code": {
                    "type": "string",
                    "description": "(Required) The bash command to execute. MUST be under 500 characters. REQUIRED when action is 'execute' or omitted."
                },
                "timeout": {
                    "type": "number",
                    "description": "(Optional) Maximum execution time in seconds (default: 6000). Returns console output if timed out."
                },
                "background": {
                    "type": "boolean",
                    "description": "(Optional) If true, runs the command in background and returns a task_id immediately. The result is automatically injected into the conversation when the command completes. Only valid when action is 'execute' (or omitted)."
                },
                "task_id": {
                    "type": "string",
                    "description": "The task ID of the background task to stop. REQUIRED when action is 'stop'. The task_id is returned when launching a background task (e.g., 'bg_1778561347235_h808ly')."
                }
            }
        }
    };
}