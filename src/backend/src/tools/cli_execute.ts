import { exec, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { Client, ClientChannel } from 'ssh2';
import { utils } from '../utils/globals';
import { logger } from '../utils/logger';
import { LLMAssistant } from '../core/LLMAssistant';
import { LLMService } from '../core/LLMService';
import { WindowManager } from '../main/windows/WindowManager';
import { State } from '../core/ReActAgent';

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
}

export interface ExecuteArgs {
    code: string;
    timeout?: number;
}
export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
    timeout?: boolean;
    message?: string;
}

// --- 辅助函数 ---
function threshold(data: string, max_lines = 40, max_chars_per_line = 200): string {
    if (!data) return data;

    let lines = data.split('\n');
    let result = '';

    if (lines.length > max_lines) {
        result += `[truncated because the output is too long, showing only last ${max_lines} lines (max ${max_chars_per_line} chars per line)]\n`;
        lines = lines.slice(-max_lines);
    }

    lines.forEach(line => {
        if (line.length > max_chars_per_line) {
            result += line.substring(0, max_chars_per_line) + '...\n';
        } else {
            result += line + '\n';
        }
    });

    return result.trim();
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
        monitor_interval: (typeof params.monitor_interval === 'number' && params.monitor_interval >= 1) ? params.monitor_interval : 10
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

// --- 主执行逻辑 ---
export function main(initialParams: CliExecuteParams = {}) {
    return async ({ code, timeout }: ExecuteArgs): Promise<ExecuteResult> => {
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

        let terminalWindow: BrowserWindow | null = null;
        try {
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
            // 注意：这里移除了原本在外层的 closed 监听，统一放入 Promise 内部处理，方便回收进程
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
            let outStream: any = null; // 可以是 fs.WriteStream 也可以是 SFTP WriteStream
            let finalOutputFilePath = ""; 
            let localTempScriptFile = ""; // 仅用于本地模式清理用

            // 用于保存最后的输出内容（防止内存泄漏）
            let tailBuffer = "";
            let errorBuffer = "";
            const MAX_TAIL_CHARS = 50000;
            
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
                }

                monitorBuffer += data;

                if (isError) {
                    errorBuffer += data;
                    if (errorBuffer.length > MAX_TAIL_CHARS) {
                        errorBuffer = errorBuffer.slice(-MAX_TAIL_CHARS);
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

                // 组装最终结果
                let finalOutput = threshold(tailBuffer, params.max_lines, params.max_chars_per_line);
                
                if (isInterrupted) {
                    finalOutput += "\n\n[Process Interrupted by User / 用户主动中断]";
                } else if (result.timeout) {
                    finalOutput += "\n\n[Process Timed Out / 执行超时]";
                }

                if (finalOutputFilePath) {
                    finalOutput += `\n\n[Complete output saved to / 完整输出已保存至: ${finalOutputFilePath}]`;
                }

                resolve({
                    success: result.success ?? false,
                    output: finalOutput,
                    error: threshold(errorBuffer, params.max_lines, params.max_chars_per_line),
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
            terminalWindow?.on('closed', () => {
                terminalWindow = null;
                if (!isResolved) {
                    isInterrupted = true;
                    if (killProcess) killProcess(true);
                    finish({ success: false, error: 'Terminal window closed by user' });
                }
            });

            // ================= 控制台输出循环监测逻辑 =================
            let llmAssistant: LLMAssistant | null = null;
            let monitorIntervalId: NodeJS.Timeout | null = null;
            const executionStartTime = Date.now();

            const monitorIntervalMinutes = initialParams?.monitor_interval ?? 10;
            const MONITOR_INTERVAL_MS = monitorIntervalMinutes * 60 * 1000;

            try {
                const tool_call = WindowManager.instance.subAgentWindow.agentTool?.tool_call;
                let llmService: LLMService;
                if (tool_call && tool_call.state === State.RUNNING) {
                    llmService = tool_call.llm_service;
                } else {
                    llmService = WindowManager.instance.mainWindow.llm_service;
                }
                llmAssistant = new LLMAssistant(llmService, null);
            } catch (initError) {
                logger.warn(`[ConsoleMonitor] Failed to initialize: ${initError}`);
            }

            const startConsoleMonitor = async (): Promise<boolean> => {
                if (!llmAssistant) return false;
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

            const sshConfig = utils.getSshConfig();
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
                        outStream.on('error', (err: Error) => logger.warn(`Remote output stream error: ${err.message}`));
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

                                // 初始化 SSH 的强杀逻辑
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
                                        
                                        // 500ms兜底，如果进程忽略了终端中断，直接断开连接强杀
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
                    outStream.on('error', (err: Error) => logger.warn(`Local output stream error: ${err.message}`));
                    logger.log(`Local output file created: ${finalOutputFilePath}`);

                    // 2. 写入本地执行脚本
                    fs.writeFileSync(localTempScriptFile, finalCode);
                    logger.log(`Temporary script file created: ${localTempScriptFile}`);
                } catch (error: any) {
                    return finish({ success: false, error: `Failed to create local files: ${error.message}` });
                }

                // 3. 运行本地脚本
                const child: ChildProcess = exec(`${params.bash} ${localTempScriptFile}`);

                // 初始化本地环境强杀逻辑
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
                        if (killProcess) killProcess(false); // 发送 SIGINT
                        
                        // 500ms兜底，如果进程未死亡则强杀
                        setTimeout(() => {
                            if (!isResolved) {
                                if (killProcess) killProcess(true); // 发送 SIGKILL
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
        "description": `A command-line tool for executing bash commands. 
        
CRITICAL LIMITATION: 
This tool CANNOT execute scripts longer than 500 characters. 

EXECUTION PIPELINE:
- For short, simple commands (e.g., 'ls -la', 'mkdir test'): Pass the command directly into 'code'.
- For complex or long multi-line scripts: 
  1. DO NOT pass the script into 'code'.
  2. Use the 'write_to_file' tool FIRST to save your script to a file (e.g., '/tmp/script.sh').
  3. Then, use this 'cli_execute' tool to run the file (e.g., pass 'bash /tmp/script.sh' into 'code').

If your execution fails due to a bug in a long script, use 'replace_in_file' to patch the file, then run 'cli_execute' again.`,
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "(Required) The bash command to execute. MUST be under 500 characters."
                },
                "timeout": {
                    "type": "number",
                    "description": "(Optional) Maximum execution time in seconds (default: 6000). Returns console output if timed out."
                }
            },
            "required": ["code"]
        }
    };
}