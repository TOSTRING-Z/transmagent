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

        // 移除 format 参数后，直接根据文件后缀自动检测类型
        const actualFileType = this._detectFileType(filePath);
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
        const { start_line, line_count, max_chars_per_line, max_cols } = raw;

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
            fileType: 'auto'
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
            const cleanup = () => { if (conn) conn.end(); };
            const endLine = startLine + lineCount - 1;

            conn.on('error', (err) => {
                cleanup();
                reject(err);
            });

            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) { cleanup(); return reject(err); }

                    sftp.on('error', (sftpErr) => {
                        cleanup();
                        reject(sftpErr);
                    });

                    const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });

                    stream.on('error', (streamErr) => {
                        cleanup();
                        reject(streamErr);
                    });

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
                        resolve(this._formatOutput(lines, startLine, endLine, totalLines, type));
                    });
                });
            }).connect(sshConfig);
        });
    }

    private async _processLocalFile(filePath: string, options: NormalizedOptions, totalLines: number): Promise<ProcessResult> {
        try {
            if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

            // === 新增：明确拦截文件夹，直接抛出普通 Error 让 catch 捕获 ===
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                throw new Error(`EISDIR: illegal operation on a directory, read. Path is a directory, not a file: ${filePath}`);
            }
            // =======================================================

            const meta = { file_path: filePath, total_lines: totalLines };
            let content = '';

            if (options.fileType === 'table') {
                content = await this._handleCSV(filePath, options, totalLines);
            } else if (['image', 'pdf'].includes(options.fileType)) {
                // 1. 统一正斜杠，防止 Windows 路径在 Markdown 中被转义
                const resolvedPath = path.resolve(filePath).replace(/\\/g, '/');
                // 2. 使用 encodeURI 对空格（变为 %20）和中文字符进行编码
                let encodedPath = encodeURI(resolvedPath);
                content = `![${path.basename(filePath)}](${encodedPath})`;

            } else if (options.fileType === 'binary') {
                // Binary file: return a download link instead of garbled text
                const resolvedPath = path.resolve(filePath).replace(/\\/g, '/');
                let encodedPath = encodeURI(resolvedPath);
                const fileName = path.basename(filePath);
                const fileSize = this._formatFileSize(stats.size);
                content = [
                    `> **Binary File Detected**: \`${fileName}\``,
                    `> **Type**: ${path.extname(filePath).toLowerCase()} file`,
                    `> **Size**: ${fileSize}`,
                    `> **Download**: [${fileName}](${encodedPath})`,
                    `>`,
                    `> ⚠️ This file type is not viewable as plain text. `,
                    `> Please use the appropriate application (e.g., Excel, Word, PowerPoint) to open it locally.`,
                ].join('\n');

            } else {
                content = await this._handleTextStream(filePath, options, totalLines);
            }

            return { success: true, content, metadata: meta };
        } catch (err: any) {
            return { success: false, error: err.message, content: '' };
        }
    }

    private _handleTextStream(filePath: string, { startLine, lineCount, maxCharsPerLine, fileType }: NormalizedOptions, totalLines: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });

            // === 新增：关键防崩溃！捕获底层流错误并抛给上层的 try...catch ===
            stream.on('error', (err) => {
                reject(err);
            });
            // =======================================================

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
                resolve(this._formatOutput(lines, startLine, endLine, totalLines, fileType));
            });
        });
    }

    private _formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIdx = 0;
        while (size >= 1024 && unitIdx < units.length - 1) {
            size /= 1024;
            unitIdx++;
        }
        return `${size.toFixed(unitIdx === 0 ? 0 : 2)} ${units[unitIdx]}`;
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

    private async _handleCSV(filePath: string, { startLine, lineCount, maxCharsPerLine, maxCols }: NormalizedOptions, totalLines: number): Promise<string> {
        // 用 Promise 包装，以便我们能接管底层事件的报错
        return new Promise(async (resolve, reject) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            
            // === 新增：拦截底层流错误 ===
            stream.on('error', (err) => reject(err));

            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            const rows: any[] = [];
            let headers: string[] = [];
            let lineIdx = 0;
            const endLine = startLine + lineCount;

            try {
                for await (const line of rl) {
                    lineIdx++;
                    const cols = line.split(','); 
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
                
                let md = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n';
                rows.forEach(r => md += '| ' + headers.map(h => r[h]).join(' | ') + ' |\n');
                md += `\n\n> *Showing rows ${startLine}-${Math.min(endLine - 1, totalLines)} of ${totalLines} total data rows.*`;
                
                resolve(md);
            } catch (err) {
                // 捕获 for await 过程中可能发生的错误
                reject(err);
            } finally {
                rl.close();
                stream.destroy();
            }
        });
    }

    private _detectFileType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        if (['.csv', '.tsv'].includes(ext)) return 'table';
        if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image';
        if (ext === '.pdf') return 'pdf';
        if (ext === '.md') return 'markdown';

        // Binary/non-text file extension blacklist
        const binaryExts = [
            '.xlsx', '.xls', '.xlsm', '.xlsb',
            '.docx', '.doc', '.docm',
            '.pptx', '.ppt', '.pptm',
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
            '.bin', '.exe', '.dll', '.so', '.dylib',
            '.o', '.obj', '.class',
            '.pyc', '.pyo',
            '.db', '.sqlite', '.sqlite3',
            '.mdb', '.accdb',
            '.vsd', '.vsdx',
            '.psd', '.ai', '.eps',
            '.ttf', '.otf', '.woff', '.woff2',
            '.mp3', '.mp4', '.avi', '.mov', '.wav',
            '.iso', '.img',
        ];
        if (binaryExts.includes(ext)) return 'binary';

        return 'text';
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
                try { conn.end(); } catch { }
            };

            conn.on('error', (err) => {
                cleanup();
                if (err.message?.includes('closed') || err.message?.includes('No response')) {
                    resolve();
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

                    sftp.on('error', (sftpErr: any) => {
                        cleanup();
                        if (sftpErr.message?.includes('No response') || sftpErr.code === 'ERR_SSH_CONNECTION_CLOSED') {
                            resolve();
                        } else {
                            reject(sftpErr);
                        }
                    });

                    sftp.fastGet(remotePath, localPath, (err: any) => {
                        cleanup();
                        if (err && (err.message?.includes('No response') || err.code === 'ERR_SSH_CONNECTION_CLOSED')) {
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

        if (result.success) {
            return result.content;
        } else {
            return `> **Error reading file:** ${result.error}\n> Path: \`${args.file_path}\``;
        }
    };
}

export function getPrompt() {
    return {
        "name": "display_file",
        "description": "Reads file content with mandatory pagination. CRITICAL: For text-based files (code, logs, CSV, MD), it returns actual readable text content. For visual files (images, PDFs), it returns markdown formatted links for UI rendering/display. Binary/non-text files (xlsx, docx, pptx, zip, exe, etc.) are automatically detected and blocked from text streaming to prevent garbled output.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": { 
                    "type": "string", 
                    "description": "Absolute path to the file." 
                },
                "start_line": { 
                    "type": "integer", 
                    "default": 1, 
                    "description": "Line number to start reading from. (Ignored for images/PDFs)" 
                },
                "line_count": {
                    "type": "integer",
                    "default": 10,
                    "description": "Number of lines to read. Defaults to 10. Max allowed is 500. Large files MUST be read in chunks. (Ignored for images/PDFs)"
                },
                "max_chars_per_line": { 
                    "type": "integer", 
                    "default": 500, 
                    "description": "Truncates long lines to prevent context overflow. (Ignored for images/PDFs)" 
                }
            },
            "required": ["file_path"]
        }
    };
}