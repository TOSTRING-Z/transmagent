import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Client, ConnectConfig } from 'ssh2';
// 根据你的实际项目路径，如果是默认导入请注意调整
import { logger } from '../utils/logger';
import { utils } from '../utils/globals';
import { WindowManager } from '../main/windows/WindowManager';

// 接口定义
export interface DisplayOptions {
    start_line?: string | number;
    end_line?: string | number;
    max_line_length?: string | number;
    max_cols?: string | number;
    file_type?: string;
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

class DisplayFile {
    private static instance: DisplayFile | null = null;
    private baseLocalPath!: string;

    constructor(localPath?: string | null) {
        if (!DisplayFile.instance) {
            this.baseLocalPath = localPath || os.tmpdir();
            // 确保目录存在
            fs.mkdirSync(this.baseLocalPath, { recursive: true });
            DisplayFile.instance = this;
        }
        return DisplayFile.instance;
    }

    /**
     * 统一入口
     */
    public async display(filePath: string, options: DisplayOptions = {}): Promise<ProcessResult> {
        const normalizedOptions = this._normalizeOptions(options);
        const sshConfig = utils.getSshConfig();

        let targetPath = filePath;
        let isRemote = false;
        let downloadInfo: { size: number; duration: string } | null = null;

        if (sshConfig?.enabled && sshConfig?.host) {
            isRemote = true;
            const localFileName = path.basename(filePath);
            targetPath = path.join(this.baseLocalPath, localFileName);

            this._emitProgress('start');

            try {
                downloadInfo = await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            } catch (err: any) {
                this._emitProgress('error', { error: err.message });
                return { success: false, content: '', error: `SSH Download Failed: ${err.message}` };
            }
        }

        const result = await this._processLocalFile(targetPath, normalizedOptions);

        if (result.success) {
            const footer: string[] = [];
            if (isRemote) {
                footer.push(`\n**Remote Source**: \`${filePath}\``);
                footer.push(`**Local Cache**: [${path.basename(targetPath)}](${targetPath})`);
            } else {
                footer.push(`\n**Local File**: [${path.basename(filePath)}](${filePath})`);
            }

            if (downloadInfo) {
                footer.push(`*Downloaded ${this._formatFileSize(downloadInfo.size)} in ${downloadInfo.duration}s*`);
            }

            result.content += '\n\n' + footer.join('\n');
        }

        return result;
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
        return `![${path.basename(filePath)}](${filePath})`;
    }

    private async _handleTextStream(filePath: string, { startLine, endLine, maxLineLength }: NormalizedOptions, type = 'text'): Promise<string> {
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        const lines: string[] = [];
        let lineIdx = 0;
        let isTruncated = false;

        try {
            for await (const line of rl) {
                lineIdx++;

                // 跳过起始行之前的行
                if (lineIdx < startLine) continue;

                // 检查是否超过了指定的结束行
                if (endLine > 0 && lineIdx > endLine) {
                    isTruncated = true;
                    // 此时我们需要主动关闭接口以停止读取
                    rl.close();
                    fileStream.destroy();
                    break;
                }

                let processedLine = line;
                if (processedLine.length > maxLineLength) {
                    processedLine = processedLine.substring(0, maxLineLength) + ' ...[truncated]';
                }
                lines.push(processedLine);
            }
        } catch (err) {
            // 忽略由于手动销毁流引起的异常
        } finally {
            rl.close();
            fileStream.destroy();
        }

        let content = lines.join('\n');

        // 只有在明确因为 endLine 限制跳出循环时才追加截断提示
        if (isTruncated) {
            content += '\n\n...[File output truncated by line limit]';
        }

        return type === 'markdown' ? content : `\`\`\`text\n${content}\n\`\`\``;
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
        } catch (err) {
            // 捕获可能的流关闭异常
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

    private _normalizeOptions(raw: DisplayOptions): NormalizedOptions {
        let { start_line, end_line, max_line_length, max_cols, file_type } = raw;
        const start = parseInt(start_line as string) || 0;
        let end = parseInt(end_line as string) || 10;
        if (start >= end && end !== 0) end = start + 20;

        return {
            startLine: Math.max(1, start),
            endLine: Math.max(0, end),
            maxLineLength: parseInt(max_line_length as string) || 500,
            maxCols: max_cols !== undefined ? parseInt(max_cols as string) : 20,
            fileType: file_type || 'auto'
        };
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

export function main(params?: { local_path?: string }) {
    return async function (args: { file_path: string } & DisplayOptions) {
        // 重置单例以防多次调用路径污染
        (DisplayFile as any).instance = null;
        const display = new DisplayFile(params?.local_path);
        const result = await display.display(args.file_path, args);
        return result.success ? result.content : `Error: ${result.error}`;
    };
}

export function getPrompt() {
    return {
        "name": "display_file",
        "description": "Reads and formats file content for display. Automatically handles source code (with syntax highlighting), structured data (as Markdown tables), and images. Supports local and SSH environments.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the target file. For remote files, ensure the SSH session is active."
                },
                "start_line": {
                    "type": "integer",
                    "default": 1,
                    "description": "The line number to start reading from (1-indexed)."
                },
                "end_line": {
                    "type": "integer",
                    "description": "The line number to stop reading (inclusive). Use 0 or omit to read until the end of the file."
                },
                "format": {
                    "type": "string",
                    "enum": ["auto", "text", "table", "image", "hex"],
                    "default": "auto",
                    "description": "Force a specific display format. 'auto' detects by extension."
                },
                "max_line_length": {
                    "type": "integer",
                    "default": 500,
                    "description": "Truncates lines exceeding this length to prevent UI overflow."
                },
                "max_cols": {
                    "type": "integer",
                    "default": 20,
                    "description": "For CSV/TSV/Excel files, limits the number of columns displayed."
                }
            },
            "required": ["file_path"]
        }
    };
}

// 本地测试代码
if (require.main === module) {
    (async () => {
        const testPath = path.join(os.tmpdir(), 'test_sample.csv');
        fs.writeFileSync(testPath, 'Name,Age,Role\nAlice,30,Dev\nBob,25,"Designer, Lead"');
        const runner = main({ local_path: os.tmpdir() });
        const res = await runner({
            file_path: testPath,
            start_line: 0,
            end_line: 5,
            max_line_length: 20,
            max_cols: 2,
            file_type: 'table'
        });

        logger.log(res);
    })();
}