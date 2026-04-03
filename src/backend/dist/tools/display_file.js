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
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const ssh2_1 = require("ssh2");
const globals_1 = require("../utils/globals");
const WindowManager_1 = require("../main/windows/WindowManager");
// 移除了多余的 Singleton 反模式
class DisplayFile {
    baseLocalPath;
    constructor(localPath) {
        this.baseLocalPath = localPath || os.tmpdir();
        if (!fs.existsSync(this.baseLocalPath)) {
            fs.mkdirSync(this.baseLocalPath, { recursive: true });
        }
    }
    /**
     * 统一入口：智能路由处理本地/远程文件
     */
    async display(filePath, options = {}) {
        const normalizedOptions = this._normalizeOptions(options);
        const sshConfig = globals_1.utils?.getSshConfig ? globals_1.utils.getSshConfig() : null;
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
                }
                catch (err) {
                    this._emitProgress('error', { error: err.message });
                    return { success: false, content: '', error: `Remote Stream Failed: ${err.message}` };
                }
            }
            // 全量下载到本地缓存处理
            let targetPath = path.join(this.baseLocalPath, `remote_${Date.now()}_${path.basename(filePath)}`);
            let downloadInfo = null;
            this._emitProgress('start');
            try {
                downloadInfo = await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            }
            catch (err) {
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
    _streamRemoteText(remotePath, sshConfig, { startLine, endLine, maxLineLength }, type = 'text') {
        return new Promise((resolve, reject) => {
            const conn = new ssh2_1.Client();
            const cleanup = () => { if (conn)
                conn.end(); };
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(new Error(`SFTP Initialization Error: ${err.message}`));
                    }
                    const stream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
                    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
                    const lines = [];
                    let lineIdx = 0;
                    let isTruncated = false;
                    rl.on('line', (line) => {
                        lineIdx++;
                        // 还没到开始行，丢弃
                        if (lineIdx < startLine)
                            return;
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
                    stream.on('error', (streamErr) => {
                        cleanup();
                        reject(new Error(`Remote Stream Error: ${streamErr.message}`));
                    });
                });
            }).on('error', (err) => {
                reject(new Error(`SSH Connection Error: ${err.message}`));
            }).connect({ ...sshConfig, readyTimeout: 20000 });
        });
    }
    /**
     * 参数规范化：强制默认 10 行的安全网
     */
    _normalizeOptions(raw) {
        // 与 getPrompt 的参数定义 "format" 保持严格一致
        const { start_line, end_line, max_line_length, max_cols, format } = raw;
        const start = Math.max(1, parseInt(start_line) || 1);
        let end = parseInt(end_line) || 0;
        // 安全网：如果没有传 end_line (值为0) 或者传了非法的范围，强制只读 10 行
        if (end === 0 || end < start) {
            end = start + 9;
        }
        return {
            startLine: start,
            endLine: end,
            maxLineLength: parseInt(max_line_length) || 500,
            maxCols: max_cols !== undefined ? parseInt(max_cols) : 20,
            fileType: format || 'auto'
        };
    }
    async _downloadViaSSH(remotePath, localPath, sshConfig) {
        return new Promise((resolve, reject) => {
            const conn = new ssh2_1.Client();
            const cleanup = () => { if (conn)
                conn.end(); };
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(err);
                    }
                    sftp.stat(remotePath, (statErr, stats) => {
                        if (statErr) {
                            cleanup();
                            return reject(new Error(`Remote file not found: ${remotePath}`));
                        }
                        const totalSize = stats.size;
                        const startTime = Date.now();
                        let lastStepTime = Date.now();
                        sftp.fastGet(remotePath, localPath, {
                            step: (transferred) => {
                                const now = Date.now();
                                if (now - lastStepTime > 500 || transferred === totalSize) {
                                    const progress = totalSize > 0 ? (transferred / totalSize) * 100 : 0;
                                    this._emitProgress('progress', { progress });
                                    lastStepTime = now;
                                }
                            }
                        }, (downloadErr) => {
                            cleanup();
                            if (downloadErr)
                                return reject(downloadErr);
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
            }).connect({ ...sshConfig, readyTimeout: 20000 });
        });
    }
    async _processLocalFile(filePath, options) {
        try {
            if (!fs.existsSync(filePath))
                throw new Error(`File not found: ${filePath}`);
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
        }
        catch (err) {
            return { success: false, error: err.message, content: '', metadata: { file_path: filePath } };
        }
    }
    _handleMedia(filePath) {
        // 直接使用传入的 filePath (如果是远程下载的，这里就是 targetPath)
        // 使用 path.resolve 确保返回的是绝对路径，方便渲染器定位
        const absolutePath = path.resolve(filePath);
        return `![${path.basename(filePath)}](${absolutePath})`;
    }
    _handleTextStream(filePath, { startLine, endLine, maxLineLength }, type = 'text') {
        return new Promise((resolve) => {
            const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
            const lines = [];
            let lineIdx = 0;
            let isTruncated = false;
            rl.on('line', (line) => {
                lineIdx++;
                if (lineIdx < startLine)
                    return;
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
                let content = lines.join('\n');
                if (isTruncated) {
                    content += '\n\n...[File output truncated by line limit]';
                }
                resolve(type === 'markdown' ? content : `\`\`\`text\n${content}\n\`\`\``);
            });
            fileStream.on('error', (err) => {
                resolve(`Error reading file stream: ${err.message}`);
            });
        });
    }
    async _handleTable(filePath, options) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.csv', '.tsv'].includes(ext)) {
            return this._handleCSV(filePath, ext === '.tsv' ? '\t' : ',', options);
        }
        else if (['.xlsx', '.xls'].includes(ext)) {
            return this._handleExcel(filePath, options);
        }
        throw new Error(`Unsupported table format: ${ext}`);
    }
    async _handleCSV(filePath, delimiter, { startLine, endLine, maxLineLength, maxCols }) {
        const getHeader = async () => {
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
        if (!totalCols)
            return "Empty CSV file";
        // 列限制处理
        if (maxCols > 0 && headers.length > maxCols) {
            headers = headers.slice(0, maxCols);
        }
        const rows = [];
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let lineIdx = 0;
        let isTruncated = false; // 关键状态位
        const dataStartLine = Math.max(2, startLine);
        try {
            for await (const line of rl) {
                lineIdx++;
                if (lineIdx === 1)
                    continue; // 跳过表头行
                if (lineIdx < dataStartLine)
                    continue;
                // 只有当 endLine 有效且当前行超过限制时，才标记为截断并退出
                if (endLine > 0 && lineIdx > endLine) {
                    isTruncated = true;
                    rl.close();
                    fileStream.destroy();
                    break;
                }
                const values = this._parseCSVLine(line, delimiter);
                const row = {};
                headers.forEach((h, i) => {
                    row[h] = values[i] || '';
                });
                rows.push(row);
            }
        }
        catch (err) {
            // 捕获可能的流关闭异常
        }
        finally {
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
    _handleExcel(filePath, { startLine, endLine, maxLineLength, maxCols }) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet['!ref'])
            return "Empty Excel file";
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
        if (jsonData.length === 0)
            return "Empty or range mismatch";
        const headers = Object.keys(jsonData[0]);
        let md = this._generateMarkdownTable(jsonData, headers, maxLineLength, totalRows > actualEnd);
        if (maxCols > 0 && totalCols > maxCols) {
            md += `\n\n> *Column output truncated. Showing first ${maxCols} of ${totalCols} columns.*`;
        }
        return md;
    }
    _generateMarkdownTable(data, headers, maxLen, isTruncated) {
        if (!data.length)
            return "No data";
        const formatCell = (val) => {
            const s = String(val == null ? '' : val).replace(/\n/g, ' ');
            return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
        };
        let md = '| ' + headers.map(formatCell).join(' | ') + ' |\n';
        md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
        data.forEach(row => { md += '| ' + headers.map(h => formatCell(row[h])).join(' | ') + ' |\n'; });
        if (isTruncated)
            md += '\n> *Table truncated. Only showing requested range.*';
        return md;
    }
    _parseCSVLine(line, delimiter) {
        const res = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"')
                inQuote = !inQuote;
            else if (char === delimiter && !inQuote) {
                res.push(cur.trim().replace(/^"|"$/g, ''));
                cur = '';
            }
            else
                cur += char;
        }
        res.push(cur.trim().replace(/^"|"$/g, ''));
        return res;
    }
    _detectFileType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const map = {
            image: ['.png', '.jpg', '.jpeg', '.gif', '.svg'],
            table: ['.xls', '.xlsx', '.csv', '.tsv'],
            pdf: ['.pdf'],
            markdown: ['.md']
        };
        for (const [type, exts] of Object.entries(map)) {
            if (exts.includes(ext))
                return type;
        }
        return 'text';
    }
    _formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return `${bytes.toFixed(2)} ${units[i]}`;
    }
    _emitProgress(state, data = {}) {
        if (WindowManager_1.WindowManager?.instance?.mainWindow?.window?.webContents) {
            WindowManager_1.WindowManager.instance.mainWindow.window.webContents.send('upload-progress', { state, ...data });
        }
    }
}
// 极其干净的入口函数
function main(params) {
    return async function (args) {
        const display = new DisplayFile(params?.local_path);
        const result = await display.display(args.file_path, args);
        return result.success ? result.content : `Error: ${result.error}`;
    };
}
function getPrompt() {
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
//# sourceMappingURL=display_file.js.map