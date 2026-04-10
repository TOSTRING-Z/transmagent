import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Client, ConnectConfig } from 'ssh2';
import { WindowManager } from '../main/windows/WindowManager';
import { ToolCall } from '../core/ToolCall';

// 接口定义 (修复了 format 参数匹配)
export interface DisplayOptions {
    start_line?: string | number;
    end_line?: string | number;
    max_line_length?: string | number;
    max_cols?: string | number;
    format?: string; // 修正：与 Prompt 保持一致
}

export interface NormalizedOptions {
    startLine: number;
    endLine: number;
    maxLineLength: number;
    maxCols: number;
    fileType: string;
}

export interface ProcessResult {
    success: boolean;
    content: string;
    error?: string;
    metadata?: any;
}

// 移除了多余的 Singleton 反模式
class DisplayFile {
    private baseLocalPath: string;

    constructor(localPath?: string | null) {
        this.baseLocalPath = localPath || os.tmpdir();
        if (!fs.existsSync(this.baseLocalPath)) {
            fs.mkdirSync(this.baseLocalPath, { recursive: true });
        }
    }


    /**
     * 统一入口：智能路由处理本地/远程文件
     */
    public async display(filePath: string, toolCall: ToolCall, options: DisplayOptions): Promise<ProcessResult> {
        const normalizedOptions = this._normalizeOptions(options);
        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

        const actualFileType = normalizedOptions.fileType === 'auto'
            ? this._detectFileType(filePath)
            : normalizedOptions.fileType;

        normalizedOptions.fileType = actualFileType;

        // ==========================================
        // 1. 远程 SSH 处理逻辑
        // ==========================================
        if (isRemote) {
            // 纯文本流式读取分支保持不变...
            if (['text', 'markdown'].includes(actualFileType)) {
                this._emitProgress('start');
                try {
                    const content = await this._streamRemoteText(filePath, sshConfig, normalizedOptions, actualFileType);
                    this._emitProgress('end', { file_path: filePath });
                    return {
                        success: true,
                        content: content + `\n\n**Remote Source**: \`${filePath}\` *(Streamed on-demand)*`,
                        metadata: { file_path: filePath }
                    };
                } catch (err: any) {
                    this._emitProgress('error', { error: err.message });
                    return { success: false, content: '', error: `Remote Stream Failed: ${err.message}` };
                }
            }

            // 全量下载到本地缓存处理
            let targetPath = path.join(this.baseLocalPath, `remote_${Date.now()}_${path.basename(filePath)}`);
            let downloadInfo: { size: number; duration: string } | null = null;

            this._emitProgress('start');
            try {
                downloadInfo = await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            } catch (err: any) {
                this._emitProgress('error', { error: err.message });
                return { success: false, content: '', error: `SSH Download Failed: ${err.message}` };
            }

            // 处理下载到本地的临时文件
            const result = await this._processLocalFile(targetPath, normalizedOptions);

            // 注意：此处移除了 fs.unlinkSync(targetPath) 的清理逻辑
            // 以确保文件保留在本地，供用户点击链接查看

            if (result.success) {
                result.content += `\n\n**Remote Source**: \`${filePath}\``;

                if (downloadInfo) {
                    result.content += `\n*Downloaded ${this._formatFileSize(downloadInfo.size)} in ${downloadInfo.duration}s*`;
                }

                // 生成跨平台兼容的 file:// 协议链接
                const absoluteLocalPath = path.resolve(targetPath);
                // 将 Windows 的反斜杠 \ 转换为正斜杠 /，确保链接在前端渲染器中可点击
                const fileUri = 'file://' + absoluteLocalPath.split(path.sep).join('/');

                result.content += `\n**Local Cache**: [Click to view downloaded file](${fileUri})`;
            }
            return result;
        }

        // ==========================================
        // 2. 本地文件处理逻辑保持不变
        // ==========================================
        const result = await this._processLocalFile(filePath, normalizedOptions);
        if (result.success) {
            result.content += `\n\n**Local File**: \`${filePath}\``;
        }
        return result;
    }

    /**
     * 按需流式读取远程大文件 (防 OOM 和网络阻塞的核心魔法)
     */
    private _streamRemoteText(
        remotePath: string,
        sshConfig: any,
        { startLine, endLine, maxLineLength }: NormalizedOptions,
        type = 'text'
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            const cleanup = () => { if (conn) conn.end(); };

            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(new Error(`SFTP Initialization Error: ${err.message}`));
                    }

                    const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
                    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

                    const lines: string[] = [];
                    let lineIdx = 0;
                    let isTruncated = false;

                    rl.on('line', (line) => {
                        lineIdx++;

                        // 还没到开始行，丢弃
                        if (lineIdx < startLine) return;

                        // 读到了指定的结束行，触发截断机制
                        if (endLine > 0 && lineIdx > endLine) {
                            isTruncated = true;
                            rl.close();
                            return;
                        }

                        let processedLine = line;
                        if (processedLine.length > maxLineLength) {
                            processedLine = processedLine.substring(0, maxLineLength) + ' ...[truncated]';
                        }
                        lines.push(processedLine);
                    });

                    rl.on('close', () => {
                        // 彻底销毁底层流，通知远端释放句柄
                        stream.destroy();
                        cleanup();

                        let content = lines.join('\n');
                        if (isTruncated) {
                            content += `\n\n...[File output truncated by strictly line limit (Showing lines ${startLine}-${endLine})]`;
                        }

                        resolve(type === 'markdown' ? content : `\`\`\`${type}\n${content}\n\`\`\``);
                    });

                    stream.on('error', (streamErr: any) => {
                        cleanup();
                        reject(new Error(`Remote Stream Error: ${streamErr.message}`));
                    });
                });
            }).on('error', (err) => {
                reject(new Error(`SSH Connection Error: ${err.message}`));
            }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
        });
    }

    /**
     * 参数规范化：强制默认 10 行的安全网
     */
    private _normalizeOptions(raw: DisplayOptions): NormalizedOptions {
        // 与 getPrompt 的参数定义 "format" 保持严格一致
        const { start_line, end_line, max_line_length, max_cols, format } = raw;

        const start = Math.max(1, parseInt(start_line as string) || 1);
        let end = parseInt(end_line as string) || 0;

        // 安全网：如果没有传 end_line (值为0) 或者传了非法的范围，强制只读 10 行
        if (end === 0 || end < start) {
            end = start + 9;
        }

        return {
            startLine: start,
            endLine: end,
            maxLineLength: parseInt(max_line_length as string) || 500,
            maxCols: max_cols !== undefined ? parseInt(max_cols as string) : 20,
            fileType: format || 'auto'
        };
    }

    private async _downloadViaSSH(remotePath: string, localPath: string, sshConfig: any): Promise<{ size: number; duration: string }> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            const cleanup = () => { if (conn) conn.end(); };

            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) { cleanup(); return reject(err); }

                    sftp.stat(remotePath, (statErr, stats) => {
                        if (statErr) { cleanup(); return reject(new Error(`Remote file not found: ${remotePath}`)); }

                        const totalSize = stats.size;
                        const startTime = Date.now();
                        let lastStepTime = Date.now();

                        sftp.fastGet(remotePath, localPath, {
                            step: (transferred: number) => {
                                const now = Date.now();
                                if (now - lastStepTime > 500 || transferred === totalSize) {
                                    const progress = totalSize > 0 ? (transferred / totalSize) * 100 : 0;
                                    this._emitProgress('progress', { progress });
                                    lastStepTime = now;
                                }
                            }
                        }, (downloadErr) => {
                            cleanup();
                            if (downloadErr) return reject(downloadErr);
                            resolve({
                                size: totalSize,
                                duration: ((Date.now() - startTime) / 1000).toFixed(2)
                            });
                        });
                    });
                });
            }).on('error', (err) => {
                cleanup();
                reject(err);
            }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
        });
    }

    private async _processLocalFile(filePath: string, options: NormalizedOptions): Promise<ProcessResult> {
        try {
            if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

            const fileType = options.fileType === 'auto'
                ? this._detectFileType(filePath)
                : options.fileType;

            const meta = { file_path: filePath, file_type: fileType, processedAt: new Date().toISOString() };
            let content = '';

            switch (fileType) {
                case 'image':
                case 'pdf':
                    content = this._handleMedia(filePath);
                    break;
                case 'table':
                    content = await this._handleTable(filePath, options);
                    break;
                case 'markdown':
                case 'text':
                default:
                    content = await this._handleTextStream(filePath, options, fileType);
                    break;
            }

            return { success: true, content, metadata: meta };
        } catch (err: any) {
            return { success: false, error: err.message, content: '', metadata: { file_path: filePath } };
        }
    }

    private _handleMedia(filePath: string): string {
        // 直接使用传入的 filePath (如果是远程下载的，这里就是 targetPath)
        // 使用 path.resolve 确保返回的是绝对路径，方便渲染器定位
        const absolutePath = path.resolve(filePath);
        return `![${path.basename(filePath)}](${absolutePath})`;
    }

    private _handleTextStream(filePath: string, { startLine, endLine, maxLineLength }: NormalizedOptions, type = 'text'): Promise<string> {
        return new Promise((resolve, reject) => {
            const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
            const lines: string[] = [];
            let lineIdx = 0;
            let isTruncated = false;
            let streamError: Error | null = null;

            rl.on('line', (line) => {
                lineIdx++;
                if (lineIdx < startLine) return;

                if (endLine > 0 && lineIdx > endLine) {
                    isTruncated = true;
                    rl.close();
                    return;
                }

                let processedLine = line;
                if (processedLine.length > maxLineLength) {
                    processedLine = processedLine.substring(0, maxLineLength) + ' ...[truncated]';
                }
                lines.push(processedLine);
            });

            rl.on('close', () => {
                fileStream.destroy();
                if (streamError) {
                    reject(streamError);
                    return;
                }
                let content = lines.join('\n');
                if (isTruncated) {
                    content += '\n\n...[File output truncated by line limit]';
                }
                resolve(type === 'markdown' ? content : `\`\`\`text\n${content}\n\`\`\``);
            });

            rl.on('error', (err) => {
                streamError = err;
                fileStream.destroy();
            });

            fileStream.on('error', (err) => {
                streamError = err;
                rl.close();
                fileStream.destroy();
            });
        });
    }

    private async _handleTable(filePath: string, options: NormalizedOptions): Promise<string> {
        const ext = path.extname(filePath).toLowerCase();
        if (['.csv', '.tsv'].includes(ext)) {
            return this._handleCSV(filePath, ext === '.tsv' ? '\t' : ',', options);
        } else if (['.xlsx', '.xls'].includes(ext)) {
            return this._handleExcel(filePath, options);
        }
        throw new Error(`Unsupported table format: ${ext}`);
    }

    private async _handleCSV(filePath: string, delimiter: string, { startLine, endLine, maxLineLength, maxCols }: NormalizedOptions): Promise<string> {
        const getHeader = async (): Promise<string[]> => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                const cols = this._parseCSVLine(line, delimiter);
                rl.close();
                stream.destroy();
                return cols;
            }
            return [];
        };

        let headers = await getHeader();
        const totalCols = headers.length;
        if (!totalCols) return "Empty CSV file";

        // 列限制处理
        if (maxCols > 0 && headers.length > maxCols) {
            headers = headers.slice(0, maxCols);
        }

        const rows: Record<string, string>[] = [];
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let lineIdx = 0;
        let isTruncated = false; // 关键状态位
        const dataStartLine = Math.max(2, startLine);

        try {
            for await (const line of rl) {
                lineIdx++;
                if (lineIdx === 1) continue; // 跳过表头行
                if (lineIdx < dataStartLine) continue;

                // 只有当 endLine 有效且当前行超过限制时，才标记为截断并退出
                if (endLine > 0 && lineIdx > endLine) {
                    isTruncated = true;
                    rl.close();
                    fileStream.destroy();
                    break;
                }

                const values = this._parseCSVLine(line, delimiter);
                const row: Record<string, string> = {};
                headers.forEach((h, i) => {
                    row[h] = values[i] || '';
                });
                rows.push(row);
            }
        } catch (err: any) {
            // 捕获可能的流关闭异常，重新抛出以便上层处理
            throw new Error(`CSV Read Error: ${err.message}`);
        } finally {
            rl.close();
            fileStream.destroy();
        }

        // 将确切的 isTruncated 状态传递给表格生成器
        let md = this._generateMarkdownTable(rows, headers, maxLineLength, isTruncated);

        if (maxCols > 0 && totalCols > maxCols) {
            md += `\n\n> *Column output truncated. Showing first ${maxCols} of ${totalCols} columns.*`;
        }
        return md;
    }

    private _handleExcel(filePath: string, { startLine, endLine, maxLineLength, maxCols }: NormalizedOptions): string {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet['!ref']) return "Empty Excel file";

        const range = XLSX.utils.decode_range(sheet['!ref']);
        const totalRows = range.e.r + 1;
        const totalCols = range.e.c + 1;

        const actualStart = Math.max(0, startLine > 0 ? startLine - 1 : 0);
        const actualEnd = endLine > 0 ? Math.min(endLine, totalRows) : totalRows;

        let actualEndCol = range.e.c;
        if (maxCols > 0) {
            actualEndCol = Math.min(range.e.c, range.s.c + maxCols - 1);
        }

        const jsonData = XLSX.utils.sheet_to_json(sheet, {
            range: { s: { c: range.s.c, r: actualStart }, e: { c: actualEndCol, r: actualEnd } },
            defval: ''
        });

        if (jsonData.length === 0) return "Empty or range mismatch";
        const headers = Object.keys(jsonData[0] as object);

        let md = this._generateMarkdownTable(jsonData as Record<string, any>[], headers, maxLineLength, totalRows > actualEnd);
        if (maxCols > 0 && totalCols > maxCols) {
            md += `\n\n> *Column output truncated. Showing first ${maxCols} of ${totalCols} columns.*`;
        }
        return md;
    }

    private _generateMarkdownTable(data: Record<string, any>[], headers: string[], maxLen: number, isTruncated: boolean): string {
        if (!data.length) return "No data";
        const formatCell = (val: any) => {
            const s = String(val == null ? '' : val).replace(/\n/g, ' ');
            return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
        };
        let md = '| ' + headers.map(formatCell).join(' | ') + ' |\n';
        md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
        data.forEach(row => { md += '| ' + headers.map(h => formatCell(row[h])).join(' | ') + ' |\n'; });
        if (isTruncated) md += '\n> *Table truncated. Only showing requested range.*';
        return md;
    }

    private _parseCSVLine(line: string, delimiter: string): string[] {
        const res: string[] = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') inQuote = !inQuote;
            else if (char === delimiter && !inQuote) { res.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
            else cur += char;
        }
        res.push(cur.trim().replace(/^"|"$/g, ''));
        return res;
    }

    private _detectFileType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: Record<string, string[]> = {
            image: ['.png', '.jpg', '.jpeg', '.gif', '.svg'],
            table: ['.xls', '.xlsx', '.csv', '.tsv'],
            pdf: ['.pdf'],
            markdown: ['.md']
        };
        for (const [type, exts] of Object.entries(map)) {
            if (exts.includes(ext)) return type;
        }
        return 'text';
    }

    private _formatFileSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return `${bytes.toFixed(2)} ${units[i]}`;
    }

    private _emitProgress(state: string, data: any = {}) {
        if (WindowManager?.instance?.mainWindow?.window?.webContents) {
            WindowManager.instance.mainWindow.window.webContents.send('upload-progress', { state, ...data });
        }
    }
}

// 极其干净的入口函数
export function main(params?: { local_path?: string }) {
    return async function (args: { file_path: string, toolCall: ToolCall; } & DisplayOptions) {
        const display = new DisplayFile(params?.local_path);
        const result = await display.display(args.file_path, args.toolCall, args);
        return result.success ? result.content : `Error: ${result.error}`;
    };
}

export function getPrompt() {
    return {
        "name": "display_file",
        "description": "Reads and formats file content for display. \n\n" +
            "CRITICAL LIMITATIONS:\n" +
            "1. **Text Extraction**: Supported for source code, logs, CSV, and Excel ONLY.\n" +
            "2. **Visual Rendering**: Images and PDFs return a placeholder for the UI to render; you will NOT see the text inside a PDF.\n" +
            "3. **Unsupported Formats**: DO NOT use this for .docx, .doc, or .pptx files. It will fail or return garbage data.\n" +
            "4. **Line Limit**: Default is 10 lines. Use pagination (start_line/end_line) for longer files.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute path to the file."
                },
                "start_line": { "type": "integer", "default": 1 },
                "end_line": { "type": "integer", "description": "Omit to read only 10 lines." },
                "format": {
                    "type": "string",
                    "enum": ["auto", "text", "table", "image", "pdf"],
                    "default": "auto",
                    "description": "Set 'table' for spreadsheet analysis, 'text' for code/logs, 'pdf'/'image' for visual display."
                },
                "max_line_length": { "type": "integer", "default": 500 },
                "max_cols": { "type": "integer", "default": 20 }
            },
            "required": ["file_path"]
        }
    };
}