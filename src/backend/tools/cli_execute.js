const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { BrowserWindow, ipcMain } = require('electron');
const { Client } = require('ssh2');
const { utils } = require('../modules/globals');

function threshold(data, max_lines = 40, max_chars_per_line = 200) {
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

function validateParams(params) {
    if (!params) {
        throw new Error('Parameters are required');
    }

    if (typeof params.timeout !== 'number' || params.timeout < 60) {
        params.timeout = 60;
    }

    if (typeof params.delay_time !== 'number' || params.delay_time < 2) {
        params.delay_time = 2;
    }

    if (typeof params.max_lines !== 'number' || params.max_lines < 10) {
        params.max_lines = 10;
    }

    if (typeof params.max_chars_per_line !== 'number' || params.max_chars_per_line < 100) {
        params.max_chars_per_line = 100;
    }

    return params;
}

function cleanupResources(tempFile, terminalWindow, conn = null) {
    try {
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    } catch (error) {
        console.warn('Failed to delete temp file:', error.message);
    }

    if (terminalWindow && !terminalWindow.isDestroyed()) {
        terminalWindow.close();
    }

    if (conn) {
        try {
            conn.end();
        } catch (error) {
            console.warn('Failed to close SSH connection:', error.message);
        }
    }
}

function main(params) {
    return async ({ code, timeout }) => {
        // 参数验证
        try {
            params = validateParams(params);
        } catch (error) {
            return {
                success: false,
                output: '',
                error: error.message
            };
        }

        // 代码验证
        if (!code || typeof code !== 'string') {
            return {
                success: false,
                output: '',
                error: 'Valid code parameter is required'
            };
        }

        // 如果传入timeout参数，则覆盖默认值
        if (timeout && typeof timeout === 'number' && timeout > params.timeout) {
            params.timeout = timeout;
        }

        // 创建临时文件
        const tempFile = path.join(os.tmpdir(), `temp_${Date.now()}.sh`);
        try {
            if (params?.bashrc) {
                code = `source ${params.bashrc};\n${code}`;
            }
            fs.writeFileSync(tempFile, code);
            console.log('Temporary file created:', tempFile);
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to create temporary file: ${error.message}`
            };
        }

        // 创建终端窗口
        let terminalWindow = null;
        try {
            terminalWindow = new BrowserWindow({
                width: 800,
                height: 600,
                frame: false,
                transparent: true,
                resizable: true,
                show: false, // 初始不显示，避免干扰用户
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            terminalWindow.loadFile('src/frontend/terminal.html');

            // 加载完成后显示窗口，但不获取焦点
            terminalWindow.once('ready-to-show', () => {
                if (params?.show) {
                    terminalWindow.show();
                }
            });
            terminalWindow.on('ready-to-show', () => {
                // terminalWindow.webContents.openDevTools();
            });
            terminalWindow.on('closed', () => {
                terminalWindow = null;
            });
        } catch (error) {
            cleanupResources(tempFile, null);
            return {
                success: false,
                output: '',
                error: `Failed to create terminal window: ${error.message}`
            };
        }

        // 窗口事件监听
        ipcMain.on('minimize-window', () => {
            terminalWindow?.minimize();
        });

        return new Promise((resolve) => {
            let output = "";
            let error = "";
            let timeoutId = null;
            let isResolved = false;

            const finish = (result) => {
                if (isResolved) return;
                isResolved = true;

                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                cleanupResources(tempFile, terminalWindow, conn);
                resolve(result);
            };

            // 设置超时
            timeoutId = setTimeout(() => {
                console.log(`Command execution timed out after ${params.timeout} seconds`);
                finish({
                    success: false, // 超时状态为失败
                    output: threshold(output, params.max_lines, params.max_chars_per_line),
                    error: threshold(error, params.max_lines, params.max_chars_per_line),
                    timeout: true, // 添加超时标志
                    message: `Command execution timed out after ${params.timeout} seconds, but returning current console output`
                });
            }, params.timeout * 1000);

            // 关闭窗口事件
            ipcMain.once('close-window', () => {
                finish({
                    success: false,
                    output: threshold(output, params.max_lines, params.max_chars_per_line),
                    error: 'Execution cancelled by user'
                });
            });

            const sshConfig = utils.getSshConfig();
            let conn = null;

            if (sshConfig?.enabled) {
                conn = new Client();

                conn.on('ready', () => {
                    console.log('SSH Connection Ready');
                    const remoteScriptPath = `/tmp/bash_script_${Date.now()}.sh`;

                    conn.sftp((sftpErr, sftp) => {
                        if (sftpErr) {
                            finish({
                                success: false,
                                output: threshold(output, params.max_lines, params.max_chars_per_line),
                                error: `SFTP error: ${sftpErr.message}`
                            });
                            return;
                        }

                        // 上传脚本文件
                        const writeStream = sftp.createWriteStream(remoteScriptPath);
                        writeStream.on('error', (writeErr) => {
                            finish({
                                success: false,
                                output: threshold(output, params.max_lines, params.max_chars_per_line),
                                error: `File upload error: ${writeErr.message}`
                            });
                        });

                        writeStream.write(`#!/bin/bash\n${code}`);
                        writeStream.end();

                        writeStream.on('close', () => {
                            // 执行远程命令
                            conn.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream) => {
                                if (execErr) {
                                    finish({
                                        success: false,
                                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                                        error: `Execution error: ${execErr.message}`
                                    });
                                    return;
                                }

                                terminalWindow?.webContents.send('terminal-data', `${code}\n`);

                                stream.on('close', (exitCode, signal) => {
                                    console.log(`Command completed: exit code ${exitCode}, signal ${signal}`);
                                    finish({
                                        success: exitCode === 0,
                                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                                        error: threshold(error, params.max_lines, params.max_chars_per_line)
                                    });
                                });

                                stream.on('data', (data) => {
                                    output += data.toString();
                                    terminalWindow?.webContents.send('terminal-data', data.toString());
                                });

                                stream.stderr.on('data', (data) => {
                                    error += data.toString();
                                    terminalWindow?.webContents.send('terminal-data', data.toString());
                                });

                                // 终端输入处理
                                const inputHandler = (event, input) => {
                                    if (!input) {
                                        stream.end();
                                    } else {
                                        stream.write(input);
                                    }
                                };

                                const signalHandler = (event, signal) => {
                                    if (signal === "ctrl_c") {
                                        stream.close();
                                    }
                                };

                                ipcMain.on('terminal-input', inputHandler);
                                ipcMain.on('terminal-signal', signalHandler);

                                // 清理事件监听器
                                stream.on('close', () => {
                                    ipcMain.removeListener('terminal-input', inputHandler);
                                    ipcMain.removeListener('terminal-signal', signalHandler);
                                });
                            });
                        });
                    });
                });

                conn.on('error', (err) => {
                    console.error('SSH Connection Error:', err);
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `SSH connection failed: ${err.message}`
                    });
                });

                conn.on('close', () => {
                    console.log('SSH Connection Closed');
                });

                // 建立连接
                try {
                    conn.connect(sshConfig);
                } catch (connectErr) {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `SSH connection failed: ${connectErr.message}`
                    });
                }

            } else {
                // 本地执行
                const child = exec(`${params.bash || 'bash'} ${tempFile}`);

                child.on('error', (childErr) => {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `Process execution failed: ${childErr.message}`
                    });
                });

                child.stdout.on('data', (data) => {
                    output += data.toString();
                    terminalWindow?.webContents.send('terminal-data', data.toString());
                });

                child.stderr.on('data', (data) => {
                    error += data.toString();
                    terminalWindow?.webContents.send('terminal-data', data.toString());
                });

                child.on('close', (exitCode) => {
                    finish({
                        success: exitCode === 0,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: threshold(error, params.max_lines, params.max_chars_per_line)
                    });
                });

                // 终端输入处理
                const inputHandler = (event, input) => {
                    if (!input) {
                        child.stdin.end();
                    } else {
                        child.stdin.write(input);
                    }
                };

                const signalHandler = (event, signal) => {
                    if (signal === "ctrl_c") {
                        child.kill('SIGINT');
                    }
                };

                ipcMain.on('terminal-input', inputHandler);
                ipcMain.on('terminal-signal', signalHandler);

                // 清理事件监听器
                child.on('close', () => {
                    ipcMain.removeListener('terminal-input', inputHandler);
                    ipcMain.removeListener('terminal-signal', signalHandler);
                });
            }
        });
    };
}

function getPrompt() {
    const prompt = `## cli_execute
Description: A command-line tool for executing bash commands in Linux environments, providing secure and efficient command execution capabilities.

Parameters:
- code: (Required) Executable bash code snippet (please strictly follow the code format, incorrect indentation and line breaks will cause code execution to fail)
- timeout: (Optional) Maximum execution time in seconds (default: At least 3600 seconds). If the command times out, the current console output will be returned with a failure status.

Usage:
{
  "thinking": "[Detailed thought process, including specifics of the executing code. If the current execution involves file content, please record the absolute file path here in detail. Consider setting an appropriate timeout for long-running commands.]",
  "tool": "cli_execute",
  "params": {
    "code": "[Code snippet to execute]",
    "timeout": [Optional timeout in seconds]
  }
}`;
    return prompt;
}

module.exports = {
    main, getPrompt
};