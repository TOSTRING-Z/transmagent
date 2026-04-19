import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { exec } from 'child_process';
import { Client, ConnectConfig } from 'ssh2';
import { WindowManager } from '../main/windows/WindowManager';
import { ToolCall } from '../core/ToolCall';

export interface DisplayOptions {
    start_line?: string | number;
    line_count?: string | number; // 相对读取行数
    max_chars_per_line?: string | number; // 消除歧义的命名
    max_cols?: string | number;
    format?: string; 
}

export interface NormalizedOptions {
    startLine: number;
    lineCount: number;
    maxCharsPerLine: number;
    maxCols: number;
    fileType: string;
}

export interface ProcessResult {
    success: boolean;
    content: string;
    error?: string;
    metadata?: any;
}

class DisplayFile {
    private baseLocalPath: string;
    private readonly SAFE_MAX_COUNT = 500; // 单次读取硬上限

    constructor(localPath?: string | null) {
        this.baseLocalPath = localPath || os.tmpdir();
        if (!fs.existsSync(this.baseLocalPath)) {
            fs.mkdirSync(this.baseLocalPath, { recursive: true });
        }
    }

    public async display(filePath: string, toolCall: ToolCall, options: DisplayOptions): Promise<ProcessResult> {
        const normalizedOptions = this._normalizeOptions(options);
        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

        const actualFileType = normalizedOptions.fileType === 'auto'
            ? this._detectFileType(filePath)
            : normalizedOptions.fileType;

        normalizedOptions.fileType = actualFileType;

        // 获取总行数 (感知文件长度的核心)
        const totalLines = await this._getTotalLines(filePath, isRemote, sshConfig);

        // ==========================================
        // 1. 远程 SSH 处理逻辑
        // ==========================================
        if (isRemote) {
            if (['text', 'markdown'].includes(actualFileType)) {
                this._emitProgress('start');
                try {
                    const content = await this._streamRemoteText(filePath, sshConfig, normalizedOptions, actualFileType, totalLines);
                    this._emitProgress('end', { file_path: filePath });
                    return {
                        success: true,
                        content: content + `\n\n**Remote Source**: \`${filePath}\``,
                        metadata: { file_path: filePath, total_lines: totalLines }
                    };
                } catch (err: any) {
                    this._emitProgress('error', { error: err.message });
                    return { success: false, content: '', error: `Remote Stream Failed: ${err.message}` };
                }
            }

            let targetPath = path.join(this.baseLocalPath, `remote_${Date.now()}_${path.basename(filePath)}`);
            this._emitProgress('start');
            try {
                await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            } catch (err: any) {
                this._emitProgress('error', { error: err.message });
                return { success: false, content: '', error: `SSH Download Failed: ${err.message}` };
            }

            const result = await this._processLocalFile(targetPath, normalizedOptions, totalLines);
            if (result.success) {
                result.content += `\n\n**Remote Source**: \`${filePath}\` (Cached locally)`;
            }
            return result;
        }

        // ==========================================
        // 2. 本地文件处理逻辑
        // ==========================================
        const result = await this._processLocalFile(filePath, normalizedOptions, totalLines);
        if (result.success) {
            result.content += `\n\n**Local File**: \`${filePath}\``;
        }
        return result;
    }

    private _normalizeOptions(raw: DisplayOptions): NormalizedOptions {
        const { start_line, line_count, max_chars_per_line, max_cols, format } = raw;

        const start = Math.max(1, parseInt(start_line as string) || 1);
        let count = parseInt(line_count as string) || 10; // 默认读取 10 行

        // 强制安全上限
        if (count > this.SAFE_MAX_COUNT) count = this.SAFE_MAX_COUNT;
        if (count <= 0) count = 10;

        return {
            startLine: start,
            lineCount: count,
            maxCharsPerLine: parseInt(max_chars_per_line as string) || 500,
            maxCols: max_cols !== undefined ? parseInt(max_cols as string) : 20,
            fileType: format || 'auto'
        };
    }

    /**
     * 高效获取文件总行数
     */
    private async _getTotalLines(filePath: string, isRemote: boolean, sshConfig: any): Promise<number> {
        if (isRemote) {
            return new Promise((resolve) => {
                const conn = new Client();
                conn.on('ready', () => {
                    conn.exec(`wc -l < "${filePath}"`, (err, stream) => {
                        if (err) { conn.end(); return resolve(0); }
                        let output = '';
                        stream.on('data', (data: any) => output += data);
                        stream.on('close', () => {
                            conn.end();
                            resolve(parseInt(output.trim()) || 0);
                        });
                    });
                }).on('error', () => resolve(0)).connect(sshConfig);
            });
        } else {
            return new Promise((resolve) => {
                if (!fs.existsSync(filePath)) return resolve(0);
                let count = 0;
                fs.createReadStream(filePath)
                    .on('data', (chunk) => {
                        for (let i = 0; i < chunk.length; ++i) if (chunk[i] === 10) count++;
                    })
                    .on('end', () => resolve(count + 1))
                    .on('error', () => resolve(0));
            });
        }
    }

    private _streamRemoteText(
        remotePath: string,
        sshConfig: any,
        { startLine, lineCount, maxCharsPerLine }: NormalizedOptions,
        type: string,
        totalLines: number
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            let isResolved = false;
            const timeoutId = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    reject(new Error('SSH stream timeout (>30s)'));
                }
            }, 30000);

            const cleanup = () => {
                clearTimeout(timeoutId);
                try { conn.end(); } catch {}
            };

            // 关键：捕获SSH连接错误，防止未捕获异常
            conn.on('error', (err) => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    // 忽略连接关闭相关的错误
                    if (err.message?.includes('closed') || err.message?.includes('No response') || err.message?.includes('ECONNRESET')) {
                        resolve(''); // 假设连接已关闭
                    } else {
                        reject(err);
                    }
                }
            });

            const endLine = startLine + lineCount - 1;

            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        if (!isResolved) {
                            isResolved = true;
                            cleanup();
                            reject(err);
                        }
                        return;
                    }

                    const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
                    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

                    const lines: string[] = [];
                    let lineIdx = 0;

                    rl.on('line', (line) => {
                        lineIdx++;
                        if (lineIdx < startLine) return;
                        if (lineIdx > endLine) { rl.close(); return; }

                        let processedLine = line;
                        if (processedLine.length > maxCharsPerLine) {
                            processedLine = processedLine.substring(0, maxCharsPerLine) + ' ...[truncated]';
                        }
                        lines.push(processedLine);
                    });

                    rl.on('close', () => {
                        stream.destroy();
                        cleanup();
                        if (!isResolved) {
                            isResolved = true;
                            resolve(this._formatOutput(lines, startLine, endLine, totalLines, type));
                        }
                    });

                    // 处理流错误
                    stream.on('error', (err: Error) => {
                        if (!isResolved) {
                            isResolved = true;
                            cleanup();
                            reject(err);
                        }
                    });

                    stream.on('close', () => {
                        if (!isResolved) {
                            isResolved = true;
                            cleanup();
                            resolve(this._formatOutput(lines, startLine, endLine, totalLines, type));
                        }
                    });
                });
            });

            conn.connect({ ...sshConfig, readyTimeout: 20000 });
        });
    }

    private async _processLocalFile(filePath: string, options: NormalizedOptions, totalLines: number): Promise<ProcessResult> {
        try {
            if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
            const meta = { file_path: filePath, total_lines: totalLines };
            let content = '';

            if (options.fileType === 'table') {
                content = await this._handleCSV(filePath, options, totalLines);
            } else if (['image', 'pdf'].includes(options.fileType)) {
                content = `![${path.basename(filePath)}](${path.resolve(filePath)})`;
            } else {
                content = await this._handleTextStream(filePath, options, totalLines);
            }

            return { success: true, content, metadata: meta };
        } catch (err: any) {
            return { success: false, error: err.message, content: '' };
        }
    }

    private _handleTextStream(filePath: string, { startLine, lineCount, maxCharsPerLine, fileType }: NormalizedOptions, totalLines: number): Promise<string> {
        return new Promise((resolve) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            const lines: string[] = [];
            let lineIdx = 0;
            const endLine = startLine + lineCount - 1;

            rl.on('line', (line) => {
                lineIdx++;
                if (lineIdx < startLine) return;
                if (lineIdx > endLine) { rl.close(); return; }

                let processedLine = line;
                if (processedLine.length > maxCharsPerLine) {
                    processedLine = processedLine.substring(0, maxCharsPerLine) + ' ...[truncated]';
                }
                lines.push(processedLine);
            });

            rl.on('close', () => {
                stream.destroy();
                resolve(this._formatOutput(lines, startLine, endLine, totalLines, fileType === 'auto' ? 'text' : fileType));
            });
        });
    }

    private _formatOutput(lines: string[], start: number, end: number, total: number, type: string): string {
        const content = lines.join('\n');
        const showEnd = Math.min(end, total);
        let info = `\n\n...[Showing lines ${start}-${showEnd} of ${total} total lines]`;
        
        if (total > showEnd) {
            info += `\n[ATTENTION]: File is too long. To read more, call display_file with start_line=${showEnd + 1}.`;
        }

        const wrap = type === 'markdown' ? content : `\`\`\`${type}\n${content}\n\`\`\``;
        return wrap + info;
    }

    // 表格处理逻辑保持精简...
    private async _handleCSV(filePath: string, { startLine, lineCount, maxCharsPerLine, maxCols }: NormalizedOptions, totalLines: number): Promise<string> {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        const rows: any[] = [];
        let headers: string[] = [];
        let lineIdx = 0;
        const endLine = startLine + lineCount;

        for await (const line of rl) {
            lineIdx++;
            const cols = line.split(','); // 简化演示
            if (lineIdx === 1) {
                headers = maxCols > 0 ? cols.slice(0, maxCols) : cols;
                continue;
            }
            if (lineIdx < startLine + 1) continue;
            if (lineIdx > endLine) break;

            const row: any = {};
            headers.forEach((h, i) => row[h] = (cols[i] || '').substring(0, maxCharsPerLine));
            rows.push(row);
        }
        rl.close();
        stream.destroy();

        let md = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n';
        rows.forEach(r => md += '| ' + headers.map(h => r[h]).join(' | ') + ' |\n');
        md += `\n\n> *Showing rows ${startLine}-${Math.min(endLine - 1, totalLines)} of ${totalLines} total data rows.*`;
        return md;
    }

    private _detectFileType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        if (['.csv', '.tsv', '.xlsx'].includes(ext)) return 'table';
        if (['.png', '.jpg', '.jpeg'].includes(ext)) return 'image';
        if (ext === '.pdf') return 'pdf';
        if (ext === '.md') return 'markdown';
        return 'text';
    }

    private _formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return `${bytes.toFixed(2)} ${units[i]}`;
    }

    private async _downloadViaSSH(remotePath: string, localPath: string, sshConfig: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            const timeoutId = setTimeout(() => {
                conn.end();
                reject(new Error('SSH download timeout (>30s)'));
            }, 30000);

            const cleanup = () => {
                clearTimeout(timeoutId);
                try { conn.end(); } catch {}
            };

            conn.on('error', (err) => {
                cleanup();
                // 忽略连接关闭错误
                if (err.message?.includes('closed') || err.message?.includes('No response')) {
                    resolve(); // 文件可能已下载完成
                } else {
                    reject(err);
                }
            });

            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(err);
                    }

                    sftp.fastGet(remotePath, localPath, (err) => {
                        cleanup();
                        // 处理 'No response from server' 错误
                        if (err && (err.message?.includes('No response') || err.code === 'ERR_SSH_CONNECTION_CLOSED')) {
                            // 假设文件已下载成功，只是连接异常关闭
                            resolve();
                        } else if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });

            conn.connect({
                ...sshConfig,
                readyTimeout: 20000,
                timeout: 30000
            });
        });
    }

    private _emitProgress(state: string, data: any = {}) {
        if (WindowManager?.instance?.mainWindow?.window?.webContents) {
            WindowManager.instance.mainWindow.window.webContents.send('upload-progress', { state, ...data });
        }
    }
}

export function main(params?: { local_path?: string }) {
    return async function (args: { file_path: string, toolCall: ToolCall; } & DisplayOptions) {
        const display = new DisplayFile(params?.local_path);
        const result = await display.display(args.file_path, args.toolCall, args);
        
        // 核心修复：坚决剥离 JSON 外壳，只向大模型输出纯 Markdown 文本
        if (result.success) {
            return result.content;
        } else {
            // 发生错误时，也使用 Markdown 格式返回明确的报错信息
            return `> **Error reading file:** ${result.error}\n> Path: \`${args.file_path}\``;
        }
    };
}

export function getPrompt() {
    return {
        "name": "display_file",
        "description": "Reads file content with mandatory pagination and length awareness. Useful for code review and log analysis.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": { "type": "string", "description": "Absolute path." },
                "start_line": { "type": "integer", "default": 1, "description": "Line number to start reading from." },
                "line_count": { 
                    "type": "integer", 
                    "default": 10, 
                    "description": "Number of lines to read. Defaults to 10. Max allowed is 500. Large files MUST be read in chunks." 
                },
                "max_chars_per_line": { "type": "integer", "default": 500, "description": "Truncates long lines to prevent context overflow." },
                "format": { "type": "string", "enum": ["auto", "text", "table", "markdown"], "default": "auto" }
            },
            "required": ["file_path"]
        }
    };
}