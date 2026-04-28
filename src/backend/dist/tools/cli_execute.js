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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const electron_1 = require("electron");
const ssh2_1 = require("ssh2");
const logger_1 = require("../utils/logger");
const public_1 = require("../utils/public");
const BackgroundTaskRegistry_1 = require("../core/BackgroundTaskRegistry");
// --- 辅助函数 ---
function threshold(data, max_lines = 40, max_chars_per_line = 200) {
    if (!data)
        return { result: data, isTruncated: false };
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
        }
        else {
            result += line + '\n';
        }
    });
    return { result: result.trim(), isTruncated };
}
function validateParams(params) {
    if (!params) {
        throw new Error('Parameters are required');
    }
    const validated = {
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
function cleanupResources(tempFile, terminalWindow, conn = null) {
    try {
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    }
    catch (error) {
        logger_1.logger.warn(`Failed to delete temp file: ${error.message}`);
    }
    if (terminalWindow && !terminalWindow.isDestroyed()) {
        terminalWindow.close();
    }
    if (conn) {
        try {
            conn.end();
        }
        catch (error) {
            logger_1.logger.warn(`Failed to close SSH connection: ${error.message}`);
        }
    }
}
// --- 后台执行核心逻辑 ---
/**
 * 在后台执行命令，完成后通过 BackgroundTaskRegistry 将结果投递到会话消息队列。
 * 不创建终端窗口、不注册 IPC 监听器。
 */
async function runInBackground(code, params, toolCall, taskId, sessionId) {
    let finalCode = code;
    if (params.bashrc) {
        finalCode = `source ${params.bashrc};\n${code}`;
    }
    const timestamp = Date.now();
    const randomStr = Math.floor(Math.random() * 1000);
    let outStream = null;
    let finalOutputFilePath = '';
    let localTempScriptFile = '';
    // 输出缓冲区
    let tailBuffer = '';
    let errorBuffer = '';
    const MAX_TAIL_CHARS = 50000;
    let isTailTruncated = false;
    let isErrorTruncated = false;
    let isInterrupted = false;
    const appendData = (data, isError = false) => {
        if (outStream) {
            try {
                outStream.write(data);
            }
            catch (e) { /* ignore */ }
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
    return new Promise((_resolve) => {
        let isFinished = false;
        let timeoutId = null;
        let killProcess = null;
        let conn = null;
        const sendToRegistry = (result) => {
            if (isFinished)
                return;
            isFinished = true;
            if (timeoutId)
                clearTimeout(timeoutId);
            if (outStream) {
                try {
                    outStream.end();
                }
                catch (e) { /* ignore */ }
            }
            if (localTempScriptFile && fs.existsSync(localTempScriptFile)) {
                try {
                    fs.unlinkSync(localTempScriptFile);
                }
                catch (e) { /* ignore */ }
            }
            if (conn) {
                try {
                    conn.end();
                }
                catch (e) { /* ignore */ }
            }
            const outThreshold = threshold(tailBuffer, params.max_lines, params.max_chars_per_line);
            const errThreshold = threshold(errorBuffer, params.max_lines, params.max_chars_per_line);
            let finalOutput = outThreshold.result;
            const finalError = errThreshold.result;
            if (isInterrupted) {
                finalOutput += '\n\n[Process Interrupted]';
            }
            else if (result.timeout) {
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
            BackgroundTaskRegistry_1.BackgroundTaskRegistry.addMessage(sessionId, taskId, message);
            logger_1.logger.log(`[BackgroundTask] Task "${taskId}" completed, message sent to session "${sessionId}"`);
        };
        // 超时处理
        timeoutId = setTimeout(() => {
            logger_1.logger.log(`[BackgroundTask] Task "${taskId}" timed out after ${params.timeout}s`);
            if (killProcess)
                killProcess(true);
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
            conn = new ssh2_1.Client();
            conn.on('ready', () => {
                logger_1.logger.log(`[BackgroundTask] SSH connected for task "${taskId}"`);
                conn.sftp((sftpErr, sftp) => {
                    if (sftpErr) {
                        return sendToRegistry({ success: false, error: `SFTP error: ${sftpErr.message}` });
                    }
                    finalOutputFilePath = `/tmp/bg_output_${timestamp}_${randomStr}.txt`;
                    outStream = sftp.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                    outStream.on('error', (err) => {
                        logger_1.logger.warn(`[BackgroundTask] Remote stream error: ${err.message}`);
                    });
                    const remoteScriptPath = `/tmp/bg_script_${timestamp}_${randomStr}.sh`;
                    const writeStream = sftp.createWriteStream(remoteScriptPath);
                    writeStream.on('error', (writeErr) => {
                        sendToRegistry({ success: false, error: `File upload error: ${writeErr.message}` });
                    });
                    writeStream.write(`#!/bin/bash\n${finalCode}`);
                    writeStream.end();
                    writeStream.on('close', () => {
                        conn.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream) => {
                            if (execErr) {
                                return sendToRegistry({ success: false, error: `Execution error: ${execErr.message}` });
                            }
                            killProcess = (force) => {
                                try {
                                    stream.close();
                                }
                                catch (e) { /* ignore */ }
                                if (force && conn) {
                                    try {
                                        conn.end();
                                    }
                                    catch (e) { /* ignore */ }
                                }
                            };
                            stream.on('close', (exitCode) => {
                                sendToRegistry({ success: exitCode === 0 && !isInterrupted });
                            });
                            stream.on('data', (data) => {
                                appendData(data.toString(), false);
                            });
                            stream.stderr.on('data', (data) => {
                                appendData(data.toString(), true);
                            });
                        });
                    });
                });
            });
            conn.on('error', (err) => {
                sendToRegistry({ success: false, error: `SSH connection failed: ${err.message}` });
            });
            try {
                conn.connect(sshConfig);
            }
            catch (connectErr) {
                sendToRegistry({ success: false, error: `SSH connection failed: ${connectErr.message}` });
            }
        }
        else {
            // =========== 本地后台执行 ===========
            finalOutputFilePath = path.join(os.tmpdir(), `bg_output_${timestamp}_${randomStr}.txt`);
            localTempScriptFile = path.join(os.tmpdir(), `bg_temp_${timestamp}_${randomStr}.sh`);
            try {
                outStream = fs.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                outStream.on('error', (err) => {
                    if (!isFinished)
                        logger_1.logger.warn(`[BackgroundTask] Local stream error: ${err.message}`);
                });
                fs.writeFileSync(localTempScriptFile, finalCode);
                logger_1.logger.log(`[BackgroundTask] Task "${taskId}" started, script: ${localTempScriptFile}`);
            }
            catch (error) {
                return sendToRegistry({ success: false, error: `Failed to create local files: ${error.message}` });
            }
            const child = (0, child_process_1.exec)(`${params.bash} ${localTempScriptFile}`);
            killProcess = (force) => {
                if (child && child.exitCode === null) {
                    child.kill(force ? 'SIGKILL' : 'SIGINT');
                }
            };
            child.on('error', (childErr) => {
                sendToRegistry({ success: false, error: `Process execution failed: ${childErr.message}` });
            });
            child.stdout?.on('data', (data) => {
                appendData(data.toString(), false);
            });
            child.stderr?.on('data', (data) => {
                appendData(data.toString(), true);
            });
            child.on('close', (exitCode) => {
                sendToRegistry({ success: exitCode === 0 && !isInterrupted });
            });
        }
    });
}
// --- 主执行逻辑 ---
function main(initialParams = {}) {
    return async ({ code, timeout, toolCall, background }) => {
        let params;
        try {
            params = validateParams(initialParams);
        }
        catch (error) {
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
            logger_1.logger.warn(errorMsg);
            return { success: false, output: '', error: errorMsg };
        }
        if (code.split('\n').length > 5 || (/[|>]/.test(code) && code.length > 200)) {
            logger_1.logger.warn(`[CliExecute] Warning: Executing potentially complex multi-line command directly.`);
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
            BackgroundTaskRegistry_1.BackgroundTaskRegistry.addTaskStart(sessionId, taskId, 'cli_execute', code);
            logger_1.logger.log(`[CliExecute] Starting background task "${taskId}" for session "${sessionId}"`);
            // 不等待，立即返回；完成后由 runInBackground 回调投递消息
            runInBackground(finalCode, params, toolCall, taskId, sessionId);
            return {
                success: true,
                output: `Background task started. Task ID: ${taskId}`,
                task_id: taskId
            };
        }
        // ================= END 后台执行分支 =================
        // 检查静默模式：静默模式下不创建窗口，除非 params.show 为 true
        const silentMode = (0, public_1.isSilentMode)();
        const shouldShowWindow = params.show && !silentMode;
        let terminalWindow = null;
        try {
            // 仅在需要显示窗口时创建终端窗口
            if (shouldShowWindow) {
                terminalWindow = new electron_1.BrowserWindow({
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
            }
            else {
                logger_1.logger.log('[CliExecute] Running in silent mode - terminal window hidden');
            }
        }
        catch (error) {
            return { success: false, output: '', error: `Failed to create terminal window: ${error.message}` };
        }
        return new Promise((resolve) => {
            let timeoutId = null;
            let isResolved = false;
            let conn = null;
            let isInterrupted = false;
            // 用于保存底层的强杀方法，屏蔽本地和远程差异
            let killProcess = null;
            // 依据执行环境动态分配：输出流及路径
            let outStream = null;
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
            const appendData = (data, isError = false) => {
                if (outStream) {
                    try {
                        outStream.write(data);
                    }
                    catch (e) {
                        logger_1.logger.warn(`Failed to write to stream: ${e.message}`);
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
            const finish = (result) => {
                if (isResolved)
                    return;
                isResolved = true;
                if (monitorIntervalId) {
                    clearInterval(monitorIntervalId);
                    monitorIntervalId = null;
                }
                if (timeoutId)
                    clearTimeout(timeoutId);
                if (outStream) {
                    try {
                        outStream.end();
                    }
                    catch (e) { }
                }
                // 清理所有主进程事件监听器
                electron_1.ipcMain.off('minimize-window', handleMinimize);
                electron_1.ipcMain.removeListener('close-window', handleCloseWindow);
                if (inputHandler)
                    electron_1.ipcMain.off('terminal-input', inputHandler);
                if (signalHandler)
                    electron_1.ipcMain.off('terminal-signal', signalHandler);
                cleanupResources(localTempScriptFile, terminalWindow, conn);
                // 获取并检查是否在格式化阶段被截断
                const outThreshold = threshold(tailBuffer, params.max_lines, params.max_chars_per_line);
                const errThreshold = threshold(errorBuffer, params.max_lines, params.max_chars_per_line);
                let finalOutput = outThreshold.result;
                const finalError = errThreshold.result;
                if (isInterrupted) {
                    finalOutput += "\n\n[Process Interrupted by User]";
                }
                else if (result.timeout) {
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
                if (killProcess)
                    killProcess(true); // 强杀底层进程
                finish({
                    success: false,
                    error: 'Execution cancelled by user'
                });
            };
            electron_1.ipcMain.on('minimize-window', handleMinimize);
            electron_1.ipcMain.once('close-window', handleCloseWindow);
            // 监听窗口被原生 X 按钮关闭的情况
            if (terminalWindow) {
                terminalWindow.on('closed', () => {
                    terminalWindow = null;
                    if (!isResolved) {
                        isInterrupted = true;
                        if (killProcess)
                            killProcess(true);
                        finish({ success: false, error: 'Terminal window closed by user' });
                    }
                });
            }
            // ================= 控制台输出循环监测逻辑 =================
            let llmAssistant = toolCall.llmAssistant;
            let monitorIntervalId = null;
            const executionStartTime = Date.now();
            const monitorIntervalMinutes = initialParams?.monitor_interval ?? 10;
            const MONITOR_INTERVAL_MS = monitorIntervalMinutes * 60 * 1000;
            const startConsoleMonitor = async () => {
                try {
                    // 消费并清空增量缓冲区，防止内存膨胀
                    const newOutput = monitorBuffer;
                    monitorBuffer = "";
                    if (newOutput.trim().length === 0)
                        return false;
                    const executionTimeMs = Date.now() - executionStartTime;
                    logger_1.logger.log(`[ConsoleMonitor] Checking output (${newOutput.length} chars, elapsed: ${Math.round(executionTimeMs / 1000)}s)...`);
                    const checkResult = await llmAssistant.checkConsoleOutput(newOutput, executionTimeMs);
                    if (checkResult.shouldInterrupt) {
                        logger_1.logger.warn(`[ConsoleMonitor] INTERRUPT: ${checkResult.reason}`);
                        isInterrupted = true;
                        if (killProcess)
                            killProcess(true);
                        finish({
                            success: false,
                            error: `[INTERRUPTED BY CONSOLE MONITOR]\nReason: ${checkResult.reason}`,
                            message: 'Execution interrupted due to detected risky operations'
                        });
                        return true;
                    }
                }
                catch (checkError) {
                    logger_1.logger.warn(`[ConsoleMonitor] Check error: ${checkError}`);
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
                logger_1.logger.log(`Command execution timed out after ${params.timeout} seconds`);
                if (killProcess)
                    killProcess(true);
                finish({
                    success: false,
                    timeout: true,
                    message: `Command execution timed out after ${params.timeout} seconds, but returning current console output`
                });
            }, params.timeout * 1000);
            const sshConfig = toolCall.utils.getSshConfig();
            let inputHandler = null;
            let signalHandler = null;
            if (sshConfig?.enabled) {
                // ================= 远程 SSH 执行模式 =================
                conn = new ssh2_1.Client();
                conn.on('ready', () => {
                    logger_1.logger.log('SSH Connection Ready');
                    conn.sftp((sftpErr, sftp) => {
                        if (sftpErr) {
                            return finish({ success: false, error: `SFTP error: ${sftpErr.message}` });
                        }
                        // 1. 设置远程输出日志文件流
                        finalOutputFilePath = `/tmp/output_${timestamp}_${randomStr}.txt`;
                        outStream = sftp.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                        outStream.on('error', (err) => {
                            if (!isResolved) {
                                logger_1.logger.warn(`Remote output stream error: ${err.message}`);
                            }
                        });
                        logger_1.logger.log(`Remote output file created: ${finalOutputFilePath}`);
                        // 2. 写入并上传执行脚本到远程
                        const remoteScriptPath = `/tmp/bash_script_${timestamp}_${randomStr}.sh`;
                        const writeStream = sftp.createWriteStream(remoteScriptPath);
                        writeStream.on('error', (writeErr) => {
                            finish({ success: false, error: `File upload error: ${writeErr.message}` });
                        });
                        writeStream.write(`#!/bin/bash\n${finalCode}`);
                        writeStream.end();
                        // 3. 执行远程脚本
                        writeStream.on('close', () => {
                            conn.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream) => {
                                if (execErr) {
                                    return finish({ success: false, error: `Execution error: ${execErr.message}` });
                                }
                                killProcess = (force) => {
                                    if (stream) {
                                        try {
                                            stream.close();
                                        }
                                        catch (e) { }
                                    }
                                    if (force && conn) {
                                        try {
                                            conn.end();
                                        }
                                        catch (e) { }
                                    }
                                };
                                terminalWindow?.webContents.send('terminal-data', `${code}\n`);
                                stream.on('close', (exitCode, signalName) => {
                                    logger_1.logger.log(`Command completed: exit code ${exitCode}, signal ${signalName}`);
                                    finish({ success: exitCode === 0 && !isInterrupted });
                                });
                                stream.on('data', (data) => {
                                    const str = data.toString();
                                    appendData(str, false);
                                    terminalWindow?.webContents.send('terminal-data', str);
                                });
                                stream.stderr.on('data', (data) => {
                                    const str = data.toString();
                                    appendData(str, true);
                                    terminalWindow?.webContents.send('terminal-data', str);
                                });
                                inputHandler = (event, input) => {
                                    if (!input)
                                        stream.end();
                                    else
                                        stream.write(input);
                                };
                                signalHandler = (event, signal) => {
                                    if (signal === "ctrl_c") {
                                        isInterrupted = true;
                                        if (killProcess)
                                            killProcess(false);
                                        setTimeout(() => {
                                            if (!isResolved) {
                                                if (killProcess)
                                                    killProcess(true);
                                                finish({ success: false });
                                            }
                                        }, 500);
                                    }
                                };
                                electron_1.ipcMain.on('terminal-input', inputHandler);
                                electron_1.ipcMain.on('terminal-signal', signalHandler);
                            });
                        });
                    });
                });
                conn.on('error', (err) => {
                    finish({ success: false, error: `SSH connection failed: ${err.message}` });
                });
                try {
                    conn.connect(sshConfig);
                }
                catch (connectErr) {
                    finish({ success: false, error: `SSH connection failed: ${connectErr.message}` });
                }
            }
            else {
                // ================= 本地执行模式 =================
                finalOutputFilePath = path.join(os.tmpdir(), `output_${timestamp}_${randomStr}.txt`);
                localTempScriptFile = path.join(os.tmpdir(), `temp_${timestamp}_${randomStr}.sh`);
                try {
                    // 1. 设置本地输出日志文件流
                    outStream = fs.createWriteStream(finalOutputFilePath, { encoding: 'utf8', flags: 'a' });
                    outStream.on('error', (err) => {
                        if (!isResolved) {
                            logger_1.logger.warn(`Local output stream error: ${err.message}`);
                        }
                    });
                    logger_1.logger.log(`Local output file created: ${finalOutputFilePath}`);
                    // 2. 写入本地执行脚本
                    fs.writeFileSync(localTempScriptFile, finalCode);
                    logger_1.logger.log(`Temporary script file created: ${localTempScriptFile}`);
                }
                catch (error) {
                    return finish({ success: false, error: `Failed to create local files: ${error.message}` });
                }
                // 3. 运行本地脚本
                const child = (0, child_process_1.exec)(`${params.bash} ${localTempScriptFile}`);
                killProcess = (force) => {
                    if (child && child.exitCode === null) {
                        child.kill(force ? 'SIGKILL' : 'SIGINT');
                    }
                };
                child.on('error', (childErr) => {
                    finish({ success: false, error: `Process execution failed: ${childErr.message}` });
                });
                child.stdout?.on('data', (data) => {
                    const str = data.toString();
                    appendData(str, false);
                    terminalWindow?.webContents.send('terminal-data', str);
                });
                child.stderr?.on('data', (data) => {
                    const str = data.toString();
                    appendData(str, true);
                    terminalWindow?.webContents.send('terminal-data', str);
                });
                child.on('close', (exitCode) => {
                    finish({ success: exitCode === 0 && !isInterrupted });
                });
                inputHandler = (event, input) => {
                    if (!input)
                        child.stdin?.end();
                    else
                        child.stdin?.write(input);
                };
                signalHandler = (event, signal) => {
                    if (signal === "ctrl_c") {
                        isInterrupted = true;
                        if (killProcess)
                            killProcess(false);
                        setTimeout(() => {
                            if (!isResolved) {
                                if (killProcess)
                                    killProcess(true);
                                finish({ success: false });
                            }
                        }, 500);
                    }
                };
                electron_1.ipcMain.on('terminal-input', inputHandler);
                electron_1.ipcMain.on('terminal-signal', signalHandler);
            }
        });
    };
}
function getPrompt() {
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
                "code": {
                    "type": "string",
                    "description": "(Required) The bash command to execute. MUST be under 500 characters."
                },
                "timeout": {
                    "type": "number",
                    "description": "(Optional) Maximum execution time in seconds (default: 6000). Returns console output if timed out."
                },
                "background": {
                    "type": "boolean",
                    "description": "(Optional) If true, runs the command in background and returns a task_id immediately. The result is automatically injected into the conversation when the command completes."
                }
            },
            "required": ["code"]
        }
    };
}
//# sourceMappingURL=cli_execute.js.map