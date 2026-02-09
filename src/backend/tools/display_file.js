const path = require('path');
const { Client } = require('ssh2');
const { utils } = require('../modules/globals');
const os = require('os');
const fs = require('fs');
const readline = require('readline');
const { WindowManager } = require("../modules/WindowManager");

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
     * 统一入口：根据配置决定处理本地还是远程文件
     */
    async display(filePath, options = {}) {
        const normalizedOptions = this._normalizeOptions(options);
        const sshConfig = utils.getSshConfig();

        let targetPath = filePath;
        let isRemote = false;
        let downloadInfo = null;

        // 判断是否需要 SSH 下载
        if (sshConfig?.enabled && sshConfig?.host) {
            isRemote = true;
            const localFileName = path.basename(filePath);
            targetPath = path.join(this.baseLocalPath, localFileName);
            
            // 发送前端进度事件
            this._emitProgress('start');
            
            try {
                downloadInfo = await this._downloadViaSSH(filePath, targetPath, sshConfig);
                this._emitProgress('end', { file_path: filePath });
            } catch (err) {
                this._emitProgress('error', { error: err.message });
                return { success: false, error: `SSH Download Failed: ${err.message}` };
            }
        }

        // 处理文件内容
        const result = await this._processLocalFile(targetPath, normalizedOptions);

        // 附加文件来源信息
        if (result.success) {
            const footer = [];
            if (isRemote) {
                footer.push(`\n**Remote Source**: \`${filePath}\``);
                // 修正：Windows下路径反斜杠转义问题，以及添加本地链接
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

    /**
     * SSH 下载逻辑重构：Promise 化与模块化
     */
    async _downloadViaSSH(remotePath, localPath, sshConfig) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            let sftpWrapper = null;
            
            const cleanup = () => {
                if (conn) conn.end();
            };

            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) {
                        cleanup();
                        return reject(err);
                    }
                    sftpWrapper = sftp;

                    sftp.stat(remotePath, (statErr, stats) => {
                        if (statErr) {
                            cleanup();
                            return reject(new Error(`Remote file not found: ${remotePath}`));
                        }

                        const totalSize = stats.size;
                        const startTime = Date.now();
                        let lastStepTime = Date.now();

                        // 快速下载
                        sftp.fastGet(remotePath, localPath, {
                            step: (transferred) => {
                                // 限制 UI 更新频率 (每 500ms 或 1% 更新一次)
                                const now = Date.now();
                                if (now - lastStepTime > 500 || transferred === totalSize) {
                                    const progress = totalSize > 0 ? (transferred / totalSize) * 100 : 0;
                                    const speed = this._calculateSpeed(transferred, startTime);
                                    
                                    this._emitProgress('progress', { progress });
                                    
                                    // 仅在控制台打印关键节点，避免刷屏
                                    if (process.env.NODE_ENV === 'development') {
                                        process.stdout.write(`\rDownloading: ${progress.toFixed(1)}% | Speed: ${speed}`);
                                    }
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
            }).connect({ ...sshConfig, readyTimeout: 20000 }); // 增加超时保护
        });
    }

    /**
     * 本地文件处理核心分发器
     */
    async _processLocalFile(filePath, options) {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const fileType = options.fileType === 'auto' 
                ? this._detectFileType(filePath) 
                : options.fileType;

            const meta = {
                file_path: filePath,
                file_type: fileType,
                processedAt: new Date().toISOString()
            };

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
                    // Markdown 和 Text 统一走流式处理，防止大文件爆内存
                    content = await this._handleTextStream(filePath, options, fileType);
                    break;
            }

            return { success: true, content, metadata: meta };

        } catch (err) {
            console.error('File processing error:', err);
            return {
                success: false,
                error: err.message,
                content: '',
                metadata: { file_path: filePath }
            };
        }
    }

    // --- 具体处理逻辑 ---

    _handleMedia(filePath) {
        const fileName = path.basename(filePath);
        // 使用相对路径或绝对路径，取决于显示环境的需求，这里保持原样
        return `![${fileName}](${filePath})`;
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
                
                // 跳过开始前的行
                if (lineIdx < startLine) continue;
                
                // 到达结束行
                if (endLine > 0 && lineIdx > endLine) {
                    isTruncated = true;
                    break; 
                }

                // 内容截断处理
                let processedLine = line;
                if (processedLine.length > maxLineLength) {
                    processedLine = processedLine.substring(0, maxLineLength) + ' ...[truncated]';
                }
                lines.push(processedLine);
            }
        } finally {
            rl.close();
            fileStream.destroy(); // 确保流关闭
        }

        let content = lines.join('\n');
        if (isTruncated) content += '\n...[File output truncated]';

        // Markdown 直接返回内容，Text 包裹代码块
        return type === 'markdown' 
            ? content 
            : `\`\`\`text\n${content}\n\`\`\``;
    }

    async _handleTable(filePath, { startLine, endLine, maxLineLength }) {
        const ext = path.extname(filePath).toLowerCase();
        
        if (['.csv', '.tsv'].includes(ext)) {
            return this._handleCSV(filePath, ext === '.tsv' ? '\t' : ',', startLine, endLine, maxLineLength);
        } else if (['.xlsx', '.xls'].includes(ext)) {
            return this._handleExcel(filePath, startLine, endLine, maxLineLength);
        } else {
            throw new Error(`Unsupported table format: ${ext}`);
        }
    }

    async _handleCSV(filePath, delimiter, startLine, endLine, maxLineLength) {
        // 读取第一行作为 Header
        const getHeader = async () => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                rl.close();
                stream.destroy();
                return this._parseCSVLine(line, delimiter);
            }
            return [];
        };

        const headers = await getHeader();
        if (!headers.length) return "Empty CSV file";

        // 读取数据行
        const rows = [];
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        
        let lineIdx = 0;
        let dataStartLine = Math.max(2, startLine); // CSV数据通常从第2行开始(1是header)

        for await (const line of rl) {
            lineIdx++;
            if (lineIdx === 1) continue; // 跳过 Header
            if (lineIdx < dataStartLine) continue;
            if (endLine > 0 && lineIdx > endLine) break;

            const values = this._parseCSVLine(line, delimiter);
            const row = {};
            headers.forEach((h, i) => {
                row[h] = values[i] || '';
            });
            rows.push(row);
        }

        return this._generateMarkdownTable(rows, headers, maxLineLength, lineIdx > endLine);
    }

    _handleExcel(filePath, startLine, endLine, maxLineLength) {
        const XLSX = require('xlsx');
        // 只读取必要的元数据，不加载整个文件内容
        const workbook = XLSX.readFile(filePath); 
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        
        if (!sheet['!ref']) return "Empty Excel file";

        const range = XLSX.utils.decode_range(sheet['!ref']);
        const totalRows = range.e.r + 1;
        
        // 限制读取范围以优化内存
        const actualStart = Math.max(0, startLine > 0 ? startLine - 1 : 0); // 0-indexed
        const actualEnd = endLine > 0 ? Math.min(endLine, totalRows) : totalRows;
        
        // 构建新的 range 字符串
        const newRange = {
            s: { c: range.s.c, r: actualStart },
            e: { c: range.e.c, r: actualEnd }
        };

        const jsonData = XLSX.utils.sheet_to_json(sheet, { 
            range: newRange,
            defval: '' // 填充空单元格
        });

        if (jsonData.length === 0) return "Empty or range mismatch";
        const headers = Object.keys(jsonData[0]);
        
        return this._generateMarkdownTable(jsonData, headers, maxLineLength, totalRows > actualEnd);
    }

    // --- 辅助工具方法 ---

    _generateMarkdownTable(data, headers, maxLen, isTruncated) {
        if (!data.length) return "No data";
        
        const formatCell = (val) => {
            const s = String(val == null ? '' : val).replace(/\n/g, ' '); // 表格内不支持换行
            return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
        };

        let md = '| ' + headers.map(formatCell).join(' | ') + ' |\n';
        md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
        
        data.forEach(row => {
            md += '| ' + headers.map(h => formatCell(row[h])).join(' | ') + ' |\n';
        });

        if (isTruncated) {
            md += '\n> *Table truncated. Only showing requested range.*';
        }

        return md;
    }

    _parseCSVLine(line, delimiter) {
        // 简易解析器，处理引号内的分隔符
        const res = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === delimiter && !inQuote) {
                res.push(cur.trim().replace(/^"|"$/g, '')); // 去除包裹的引号
                cur = '';
            } else {
                cur += char;
            }
        }
        res.push(cur.trim().replace(/^"|"$/g, ''));
        return res;
    }

    _normalizeOptions(raw) {
        let { start_line, end_line, max_line_length, file_type } = raw;
        
        const start = parseInt(start_line) || 0;
        let end = parseInt(end_line) || 10;
        
        // 智能修正 range
        if (start >= end && end !== 0) {
            end = start + 20;
        }

        return {
            startLine: Math.max(1, start), // 1-based logic usually better for user
            endLine: Math.max(0, end),
            maxLineLength: parseInt(max_line_length) || 500,
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
        for (const [type, exts] of Object.entries(map)) {
            if (exts.includes(ext)) return type;
        }
        return 'text';
    }

    _calculateSpeed(bytes, startTime) {
        const seconds = (Date.now() - startTime) / 1000;
        if (seconds <= 0) return '0 B/s';
        return this._formatSpeed(bytes / seconds);
    }

    _formatSpeed(bps) {
        if (bps < 1024) return `${Math.round(bps)} B/s`;
        if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
        return `${(bps / 1048576).toFixed(1)} MB/s`;
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
        if (WindowManager?.instance?.mainWindow?.window?.webContents) {
            WindowManager.instance.mainWindow.window.webContents.send('upload-progress', { state, ...data });
        }
    }
}

// 模块导出与主函数封装
DisplayFile.instance = null;

function main(params) {
    return async function (args) {
        const display = new DisplayFile(params?.local_path);
        // 参数名映射兼容
        const result = await display.display(args.file_path, args);
        
        if (result.success) {
            return result.content;
        } else {
            return `Error processing file: ${result.error}`;
        }
    }
}

function getPrompt() {
    return `## display_file
Description: Display various file types (images, tables, text) in Markdown format. Supports remote SSH file retrieval and local caching.
- Optimized for large files (streaming) and network resilience.
- Auto-detects file types (.png, .xlsx, .csv, .md, .txt, etc.).

Parameters:
- file_path: (Required) Absolute path to the file.
- start_line: Start line for text/tables (default: 0).
- end_line: End line (default: 10). Set 0 for all (use caution).
- max_line_length: Max chars per line (default: 500).

Usage:
{
  "tool": "display_file",
  "params": {
    "file_path": "/path/to/file.ext",
    "start_line": 0,
    "end_line": 20
  }
}`;
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
            file_type: 'table'
        });
        console.log(res);
    })();
}

module.exports = { main, getPrompt };