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
    // 删除了 mode 和 mode_reason
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

        // ================= 重构后的拦截逻辑 START =================
        // 1. 绝对长度拦截（强制推行 Script-Then-Execute 管道）
        const MAX_DIRECT_CODE_LENGTH = 500;
        if (code.length > MAX_DIRECT_CODE_LENGTH) {
            const errorMsg = `Execution blocked: Command is too long (${code.length} chars). ` +
                `Max allowed is ${MAX_DIRECT_CODE_LENGTH}. ` +
                `ACTION REQUIRED: Please use the 'write_to_file' tool to save this script to a temporary file (e.g., /tmp/task.sh) first, ` +
                `then use 'cli_execute' with a short command like 'bash /tmp/task.sh' to run it.`;
            logger.warn(errorMsg);
            return { success: false, output: '', error: errorMsg };
        }

        // 2. 危险或复杂逻辑的启发式警告 (可选，不阻断，仅记录)
        if (code.split('\n').length > 5 || (/[|>]/.test(code) && code.length > 200)) {
            logger.warn(`[CliExecute] Warning: Executing potentially complex multi-line command directly.`);
        }
        // ================= 重构后的拦截逻辑 END =================

        if (typeof timeout === 'number' && timeout > params.timeout) {
            params.timeout = timeout;
        }

        const tempFile = path.join(os.tmpdir(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.sh`);
        try {
            let finalCode = code;
            if (params.bashrc) {
                finalCode = `source ${params.bashrc};\n${code}`;
            }
            fs.writeFileSync(tempFile, finalCode);
            logger.log(`Temporary file created: ${tempFile}`);
        } catch (error: any) {
            return { success: false, output: '', error: `Failed to create temporary file: ${error.message}` };
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

            terminalWindow.on('closed', () => {
                terminalWindow = null;
            });
        } catch (error: any) {
            cleanupResources(tempFile, null);
            return { success: false, output: '', error: `Failed to create terminal window: ${error.message}` };
        }

        return new Promise((resolve) => {
            let output = "";
            let errorMsg = "";
            let timeoutId: NodeJS.Timeout | null = null;
            let isResolved = false;
            let conn: Client | null = null;

            // 集中管理需要注销的 IPC 监听器
            const handleMinimize = () => { terminalWindow?.minimize(); };
            const handleCloseWindow = () => {
                finish({
                    success: false,
                    output: threshold(output, params.max_lines, params.max_chars_per_line),
                    error: 'Execution cancelled by user'
                });
            };

            ipcMain.on('minimize-window', handleMinimize);
            ipcMain.once('close-window', handleCloseWindow);

            // ================= 控制台输出循环监测逻辑 =================
            let llmAssistant: LLMAssistant | null = null;
            let monitorIntervalId: NodeJS.Timeout | null = null;
            let lastCheckedLength = 0;
            const executionStartTime = Date.now(); // 记录执行开始时间
            
            // 从 initialParams 读取监测间隔（默认10分钟）
            const monitorIntervalMinutes = initialParams?.monitor_interval ?? 10;
            const MONITOR_INTERVAL_MS = monitorIntervalMinutes * 60 * 1000;

            try {
                const llmService = new LLMService();
                llmAssistant = new LLMAssistant(llmService, null);
            } catch (initError) {
                logger.warn(`[ConsoleMonitor] Failed to initialize: ${initError}`);
            }

            const startConsoleMonitor = async (): Promise<boolean> => {
                if (!llmAssistant) return false;
                try {
                    const currentOutput = output + errorMsg;
                    if (currentOutput.length <= lastCheckedLength) return false;
                    const newOutput = currentOutput.substring(lastCheckedLength);
                    lastCheckedLength = currentOutput.length;
                    if (newOutput.trim().length === 0) return false;

                    // 计算当前执行时间
                    const executionTimeMs = Date.now() - executionStartTime;

                    logger.log(`[ConsoleMonitor] Checking output (${newOutput.length} chars, elapsed: ${Math.round(executionTimeMs/1000)}s)...`);
                    
                    // 传入控制台输出和执行时间
                    const checkResult = await llmAssistant.checkConsoleOutput(newOutput, executionTimeMs);

                    if (checkResult.shouldInterrupt) {
                        logger.warn(`[ConsoleMonitor] INTERRUPT: ${checkResult.reason}`);
                        if (conn) conn.end();
                        finish({
                            success: false,
                            output: threshold(output, params.max_lines, params.max_chars_per_line),
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

            const finish = (result: ExecuteResult) => {
                if (isResolved) return;
                isResolved = true;

                if (monitorIntervalId) {
                    clearInterval(monitorIntervalId);
                    monitorIntervalId = null;
                }

                if (timeoutId) clearTimeout(timeoutId);

                // 彻底清理所有主进程事件监听器
                ipcMain.off('minimize-window', handleMinimize);
                ipcMain.removeListener('close-window', handleCloseWindow);
                if (inputHandler) ipcMain.off('terminal-input', inputHandler);
                if (signalHandler) ipcMain.off('terminal-signal', signalHandler);

                cleanupResources(tempFile, terminalWindow, conn);
                resolve(result);
            };

            timeoutId = setTimeout(() => {
                logger.log(`Command execution timed out after ${params.timeout} seconds`);
                finish({
                    success: false,
                    output: threshold(output, params.max_lines, params.max_chars_per_line),
                    error: threshold(errorMsg, params.max_lines, params.max_chars_per_line),
                    timeout: true,
                    message: `Command execution timed out after ${params.timeout} seconds, but returning current console output`
                });
            }, params.timeout * 1000);

            const sshConfig = utils.getSshConfig();

            // 提取共享的输入输出处理句柄
            let inputHandler: ((event: IpcMainEvent, input: string) => void) | null = null;
            let signalHandler: ((event: IpcMainEvent, signal: string) => void) | null = null;

            if (sshConfig?.enabled) {
                conn = new Client();

                conn.on('ready', () => {
                    logger.log('SSH Connection Ready');
                    const remoteScriptPath = `/tmp/bash_script_${Date.now()}.sh`;

                    conn!.sftp((sftpErr, sftp) => {
                        if (sftpErr) {
                            return finish({
                                success: false,
                                output: threshold(output, params.max_lines, params.max_chars_per_line),
                                error: `SFTP error: ${sftpErr.message}`
                            });
                        }

                        const writeStream = sftp.createWriteStream(remoteScriptPath);
                        writeStream.on('error', (writeErr: Error) => {
                            finish({
                                success: false,
                                output: threshold(output, params.max_lines, params.max_chars_per_line),
                                error: `File upload error: ${writeErr.message}`
                            });
                        });

                        writeStream.write(`#!/bin/bash\n${code}`);
                        writeStream.end();

                        writeStream.on('close', () => {
                            conn!.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream: ClientChannel) => {
                                if (execErr) {
                                    return finish({
                                        success: false,
                                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                                        error: `Execution error: ${execErr.message}`
                                    });
                                }

                                terminalWindow?.webContents.send('terminal-data', `${code}\n`);

                                stream.on('close', (exitCode: number, signalName: string) => {
                                    logger.log(`Command completed: exit code ${exitCode}, signal ${signalName}`);
                                    finish({
                                        success: exitCode === 0,
                                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                                        error: threshold(errorMsg, params.max_lines, params.max_chars_per_line)
                                    });
                                });

                                stream.on('data', (data: Buffer) => {
                                    const str = data.toString();
                                    output += str;
                                    terminalWindow?.webContents.send('terminal-data', str);
                                });

                                stream.stderr.on('data', (data: Buffer) => {
                                    const str = data.toString();
                                    errorMsg += str;
                                    terminalWindow?.webContents.send('terminal-data', str);
                                });

                                inputHandler = (event, input) => {
                                    if (!input) stream.end();
                                    else stream.write(input);
                                };

                                signalHandler = (event, signal) => {
                                    if (signal === "ctrl_c") stream.close();
                                };

                                ipcMain.on('terminal-input', inputHandler);
                                ipcMain.on('terminal-signal', signalHandler);
                            });
                        });
                    });
                });

                conn.on('error', (err: Error) => {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `SSH connection failed: ${err.message}`
                    });
                });

                try {
                    conn.connect(sshConfig);
                } catch (connectErr: any) {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `SSH connection failed: ${connectErr.message}`
                    });
                }

            } else {
                // 本地执行
                const child: ChildProcess = exec(`${params.bash} ${tempFile}`);

                child.on('error', (childErr: Error) => {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `Process execution failed: ${childErr.message}`
                    });
                });

                child.stdout?.on('data', (data: Buffer | string) => {
                    const str = data.toString();
                    output += str;
                    terminalWindow?.webContents.send('terminal-data', str);
                });

                child.stderr?.on('data', (data: Buffer | string) => {
                    const str = data.toString();
                    errorMsg += str;
                    terminalWindow?.webContents.send('terminal-data', str);
                });

                child.on('close', (exitCode: number | null) => {
                    finish({
                        success: exitCode === 0,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: threshold(errorMsg, params.max_lines, params.max_chars_per_line)
                    });
                });

                inputHandler = (event, input) => {
                    if (!input) child.stdin?.end();
                    else child.stdin?.write(input);
                };

                signalHandler = (event, signal) => {
                    if (signal === "ctrl_c") child.kill('SIGINT');
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