// @ts-nocheck
const path = require('path');
const { Client } = require('ssh2');
const { utils } = require('../utils/globals');
const os = require('os');
const fs = require('fs');
const readline = require('readline');
const { WindowManager } = require("../main/windows/WindowManager");

class DisplayFile {
    constructor(localPath = null) {
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
    async display(filePath, options = {}) {
        const normalizedOptions = this._normalizeOptions(options);
        const sshConfig = utils.getSshConfig();

        let targetPath = filePath;
        let isRemote = false;
        let downloadInfo = null;

        if (sshConfig?.enabled && sshConfig?.host) {
            isRemote = true;
            const localFileName = path.basename(filePath);
            targetPath = path.join(this.baseLocalPath, localFileName);

            this._emitProgress('start');

            try {
                downloadInfo = await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            } catch (err) {
                this._emitProgress('error', { error: err.message });
                return { success: false, error: `SSH Download Failed: ${err.message}` };
            }
        }

        const result = await this._processLocalFile(targetPath, normalizedOptions);

        if (result.success) {
            const footer = [];
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

    async _downloadViaSSH(remotePath, localPath, sshConfig) {
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
            }).connect({ ...sshConfig, readyTimeout: 20000 });
        });
    }

    async _processLocalFile(filePath, options) {
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
        } catch (err) {
            return { success: false, error: err.message, content: '', metadata: { file_path: filePath } };
        }
    }

    _handleMedia(filePath) {
        return `![${path.basename(filePath)}](${filePath})`;
    }

    async _handleTextStream(filePath, { startLine, endLine, maxLineLength }, type = 'text') {
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        const lines = [];
        let lineIdx = 0;
        let isTruncated = false;

        try {
            for await (const line of rl) {
                lineIdx++;
                if (lineIdx < startLine) continue;
                if (endLine > 0 && lineIdx > endLine) { isTruncated = true; break; }

                let processedLine = line;
                if (processedLine.length > maxLineLength) {
                    processedLine = processedLine.substring(0, maxLineLength) + ' ...[truncated]';
                }
                lines.push(processedLine);
            }
        } finally {
            rl.close();
            fileStream.destroy();
        }

        let content = lines.join('\n');
        if (isTruncated) content += '\n...[File output truncated]';
        return type === 'markdown' ? content : `\`\`\`text\n${content}\n\`\`\``;
    }

    async _handleTable(filePath, options) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.csv', '.tsv'].includes(ext)) {
            return this._handleCSV(filePath, ext === '.tsv' ? '\t' : ',', options);
        } else if (['.xlsx', '.xls'].includes(ext)) {
            return this._handleExcel(filePath, options);
        }
        throw new Error(`Unsupported table format: ${ext}`);
    }

    async _handleCSV(filePath, delimiter, { startLine, endLine, maxLineLength, maxCols }) {
        const getHeader = async () => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                rl.close(); stream.destroy();
                return this._parseCSVLine(line, delimiter);
            }
            return [];
        };

        let headers = await getHeader();
        const totalCols = headers.length;
        if (!totalCols) return "Empty CSV file";

        // 列限制
        if (maxCols > 0 && headers.length > maxCols) {
            headers = headers.slice(0, maxCols);
        }

        const rows = [];
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let lineIdx = 0;
        let dataStartLine = Math.max(2, startLine);

        for await (const line of rl) {
            lineIdx++;
            if (lineIdx === 1) continue;
            if (lineIdx < dataStartLine) continue;
            if (endLine > 0 && lineIdx > endLine) break;

            const values = this._parseCSVLine(line, delimiter);
            const row = {};
            headers.forEach((h, i) => { row[h] = values[i] || ''; });
            rows.push(row);
        }

        let md = this._generateMarkdownTable(rows, headers, maxLineLength, lineIdx > endLine);
        if (maxCols > 0 && totalCols > maxCols) {
            md += `\n\n> *Column output truncated. Showing first ${maxCols} of ${totalCols} columns.*`;
        }
        return md;
    }

    _handleExcel(filePath, { startLine, endLine, maxLineLength, maxCols }) {
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
        const headers = Object.keys(jsonData[0]);

        let md = this._generateMarkdownTable(jsonData, headers, maxLineLength, totalRows > actualEnd);
        if (maxCols > 0 && totalCols > maxCols) {
            md += `\n\n> *Column output truncated. Showing first ${maxCols} of ${totalCols} columns.*`;
        }
        return md;
    }

    _generateMarkdownTable(data, headers, maxLen, isTruncated) {
        if (!data.length) return "No data";
        const formatCell = (val) => {
            const s = String(val == null ? '' : val).replace(/\n/g, ' ');
            return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
        };
        let md = '| ' + headers.map(formatCell).join(' | ') + ' |\n';
        md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
        data.forEach(row => { md += '| ' + headers.map(h => formatCell(row[h])).join(' | ') + ' |\n'; });
        if (isTruncated) md += '\n> *Table truncated. Only showing requested range.*';
        return md;
    }

    _parseCSVLine(line, delimiter) {
        const res = [];
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

    _normalizeOptions(raw) {
        let { start_line, end_line, max_line_length, max_cols, file_type } = raw;
        const start = parseInt(start_line) || 0;
        let end = parseInt(end_line) || 10;
        if (start >= end && end !== 0) end = start + 20;

        return {
            startLine: Math.max(1, start),
            endLine: Math.max(0, end),
            maxLineLength: parseInt(max_line_length) || 500,
            maxCols: max_cols !== undefined ? parseInt(max_cols) : 20,
            fileType: file_type || 'auto'
        };
    }

    _detectFileType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const map = {
            image: ['.png', '.jpg', '.jpeg', '.gif', '.svg'],
            table: ['.xls', '.xlsx', '.csv', '.tsv'],
            pdf: ['.pdf'],
            markdown: ['.md']
        };
        for (const [type, exts] of Object.entries(map)) if (exts.includes(ext)) return type;
        return 'text';
    }

    _formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return `${bytes.toFixed(2)} ${units[i]}`;
    }

    _emitProgress(state, data = {}) {
        if (WindowManager?.instance?.mainWindow?.window?.webContents) {
            WindowManager.instance.mainWindow.window.webContents.send('upload-progress', { state, ...data });
        }
    }
}

DisplayFile.instance = null;

function main(params) {
    return async function (args) {
        const display = new DisplayFile(params?.local_path);
        const result = await display.display(args.file_path, args);
        return result.success ? result.content : `Error: ${result.error}`;
    }
}

function getPrompt() {
    return {
        "name": "display_file",
        "description": "Display various files (images, tables, text) in Markdown. Supports SSH and local files.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": { "type": "string", "description": "Absolute path to the file." },
                "start_line": { "type": "string", "description": "Start line (default: 0)." },
                "end_line": { "type": "string", "description": "End line (default: 10, 0 for all)." },
                "max_line_length": { "type": "number", "description": "Max chars per line (default: 500)." },
                "max_cols": { "type": "number", "description": "Max columns for tables (default: 20)." }
            },
            "required": ["file_path"]
        }
    };
}

if (require.main === module) {
    (async () => {
        // Mock environment for testing
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

        console.log(res);

    })();

}

export { main, getPrompt };