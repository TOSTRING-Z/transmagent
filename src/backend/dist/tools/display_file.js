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
const WindowManager_1 = require("../main/windows/WindowManager");
class DisplayFile {
    baseLocalPath;
    SAFE_MAX_COUNT = 500; // 单次读取硬上限
    constructor(localPath) {
        this.baseLocalPath = localPath || os.tmpdir();
        if (!fs.existsSync(this.baseLocalPath)) {
            fs.mkdirSync(this.baseLocalPath, { recursive: true });
        }
    }
    async display(filePath, toolCall, options) {
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
                }
                catch (err) {
                    this._emitProgress('error', { error: err.message });
                    return { success: false, content: '', error: `Remote Stream Failed: ${err.message}` };
                }
            }
            let targetPath = path.join(this.baseLocalPath, `remote_${Date.now()}_${path.basename(filePath)}`);
            this._emitProgress('start');
            try {
                await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            }
            catch (err) {
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
    _normalizeOptions(raw) {
        const { start_line, line_count, max_chars_per_line, max_cols } = raw;
        const start = Math.max(1, parseInt(start_line) || 1);
        let count = parseInt(line_count) || 10; // 默认读取 10 行
        // 强制安全上限
        if (count > this.SAFE_MAX_COUNT)
            count = this.SAFE_MAX_COUNT;
        if (count <= 0)
            count = 10;
        return {
            startLine: start,
            lineCount: count,
            maxCharsPerLine: parseInt(max_chars_per_line) || 500,
            maxCols: max_cols !== undefined ? parseInt(max_cols) : 20,
            fileType: 'auto'
        };
    }
    /**
     * 高效获取文件总行数
     */
    async _getTotalLines(filePath, isRemote, sshConfig) {
        if (isRemote) {
            return new Promise((resolve) => {
                const conn = new ssh2_1.Client();
                conn.on('ready', () => {
                    conn.exec(`wc -l < "${filePath}"`, (err, stream) => {
                        if (err) {
                            conn.end();
                            return resolve(0);
                        }
                        let output = '';
                        stream.on('data', (data) => output += data);
                        stream.on('close', () => {
                            conn.end();
                            resolve(parseInt(output.trim()) || 0);
                        });
                    });
                }).on('error', () => resolve(0)).connect(sshConfig);
            });
        }
        else {
            return new Promise((resolve) => {
                if (!fs.existsSync(filePath))
                    return resolve(0);
                let count = 0;
                fs.createReadStream(filePath)
                    .on('data', (chunk) => {
                    for (let i = 0; i < chunk.length; ++i)
                        if (chunk[i] === 10)
                            count++;
                })
                    .on('end', () => resolve(count + 1))
                    .on('error', () => resolve(0));
            });
        }
    }
    _streamRemoteText(remotePath, sshConfig, { startLine, lineCount, maxCharsPerLine }, type, totalLines) {
        return new Promise((resolve, reject) => {
            const conn = new ssh2_1.Client();
            const cleanup = () => { if (conn)
                conn.end(); };
            const endLine = startLine + lineCount - 1;
            conn.on('error', (err) => {
                cleanup();
                reject(err);
            });
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(err);
                    }
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
                    const lines = [];
                    let lineIdx = 0;
                    rl.on('line', (line) => {
                        lineIdx++;
                        if (lineIdx < startLine)
                            return;
                        if (lineIdx > endLine) {
                            rl.close();
                            return;
                        }
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
    async _processLocalFile(filePath, options, totalLines) {
        try {
            if (!fs.existsSync(filePath))
                throw new Error(`File not found: ${filePath}`);
            const meta = { file_path: filePath, total_lines: totalLines };
            let content = '';
            if (options.fileType === 'table') {
                content = await this._handleCSV(filePath, options, totalLines);
            }
            else if (['image', 'pdf'].includes(options.fileType)) {
                content = `![${path.basename(filePath)}](${path.resolve(filePath)})`;
            }
            else {
                content = await this._handleTextStream(filePath, options, totalLines);
            }
            return { success: true, content, metadata: meta };
        }
        catch (err) {
            return { success: false, error: err.message, content: '' };
        }
    }
    _handleTextStream(filePath, { startLine, lineCount, maxCharsPerLine, fileType }, totalLines) {
        return new Promise((resolve) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            const lines = [];
            let lineIdx = 0;
            const endLine = startLine + lineCount - 1;
            rl.on('line', (line) => {
                lineIdx++;
                if (lineIdx < startLine)
                    return;
                if (lineIdx > endLine) {
                    rl.close();
                    return;
                }
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
    _formatOutput(lines, start, end, total, type) {
        const content = lines.join('\n');
        const showEnd = Math.min(end, total);
        let info = `\n\n...[Showing lines ${start}-${showEnd} of ${total} total lines]`;
        if (total > showEnd) {
            info += `\n[ATTENTION]: File is too long. To read more, call display_file with start_line=${showEnd + 1}.`;
        }
        const wrap = type === 'markdown' ? content : `\`\`\`${type}\n${content}\n\`\`\``;
        return wrap + info;
    }
    async _handleCSV(filePath, { startLine, lineCount, maxCharsPerLine, maxCols }, totalLines) {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        const rows = [];
        let headers = [];
        let lineIdx = 0;
        const endLine = startLine + lineCount;
        for await (const line of rl) {
            lineIdx++;
            const cols = line.split(',');
            if (lineIdx === 1) {
                headers = maxCols > 0 ? cols.slice(0, maxCols) : cols;
                continue;
            }
            if (lineIdx < startLine + 1)
                continue;
            if (lineIdx > endLine)
                break;
            const row = {};
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
    _detectFileType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.csv', '.tsv', '.xlsx'].includes(ext))
            return 'table';
        if (['.png', '.jpg', '.jpeg'].includes(ext))
            return 'image';
        if (ext === '.pdf')
            return 'pdf';
        if (ext === '.md')
            return 'markdown';
        return 'text';
    }
    async _downloadViaSSH(remotePath, localPath, sshConfig) {
        return new Promise((resolve, reject) => {
            const conn = new ssh2_1.Client();
            const timeoutId = setTimeout(() => {
                conn.end();
                reject(new Error('SSH download timeout (>30s)'));
            }, 30000);
            const cleanup = () => {
                clearTimeout(timeoutId);
                try {
                    conn.end();
                }
                catch { }
            };
            conn.on('error', (err) => {
                cleanup();
                if (err.message?.includes('closed') || err.message?.includes('No response')) {
                    resolve();
                }
                else {
                    reject(err);
                }
            });
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(err);
                    }
                    sftp.on('error', (sftpErr) => {
                        cleanup();
                        if (sftpErr.message?.includes('No response') || sftpErr.code === 'ERR_SSH_CONNECTION_CLOSED') {
                            resolve();
                        }
                        else {
                            reject(sftpErr);
                        }
                    });
                    sftp.fastGet(remotePath, localPath, (err) => {
                        cleanup();
                        if (err && (err.message?.includes('No response') || err.code === 'ERR_SSH_CONNECTION_CLOSED')) {
                            resolve();
                        }
                        else if (err) {
                            reject(err);
                        }
                        else {
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
    _emitProgress(state, data = {}) {
        if (WindowManager_1.WindowManager?.instance?.mainWindow?.window?.webContents) {
            WindowManager_1.WindowManager.instance.mainWindow.window.webContents.send('upload-progress', { state, ...data });
        }
    }
}
function main(params) {
    return async function (args) {
        const display = new DisplayFile(params?.local_path);
        const result = await display.display(args.file_path, args.toolCall, args);
        if (result.success) {
            return result.content;
        }
        else {
            return `> **Error reading file:** ${result.error}\n> Path: \`${args.file_path}\``;
        }
    };
}
function getPrompt() {
    return {
        "name": "display_file",
        "description": "Reads file content with mandatory pagination. CRITICAL: For text-based files (code, logs, CSV, MD), it returns actual readable text content. For visual/binary files (images, PDFs), it ONLY returns markdown formatted links for UI rendering/display, and CANNOT extract internal text or pixels.",
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
//# sourceMappingURL=display_file.js.map