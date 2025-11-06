const path = require('path');
const { Client } = require('ssh2');
const { utils } = require('../modules/globals')
const os = require('os');
const fs = require('fs');
const readline = require('readline');
const { WindowManager } = require("../modules/WindowManager");

class DisplayFile {
  constructor(local_path = null) {
    if (!DisplayFile.instance) {
      this.local_path = local_path || os.tmpdir();
      // 判断本地路径是否存在，如果不存在则创建
      if (!fs.existsSync(this.local_path)) {
        fs.mkdirSync(this.local_path, { recursive: true });
      }
      DisplayFile.instance = this;
    }
    return DisplayFile.instance;
  }

  // SSH下载文件方法（带进度监控）
  async downloadViaSSHWithProgress(remotePath, localPath, options = {}) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const sshConfig = utils.getSshConfig();
      const timeoutMs = options.timeout || 60 * 60 * 1000; // 60 minutes
      let timeoutId;
      let progressInterval;
      let lastSize = 0;
      let stallCount = 0;
      const maxStallCount = 5; // 最大停滞次数

      // 超时处理
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`SSH连接超时: ${timeoutMs}ms`));
      }, timeoutMs);

      // 清理函数
      const cleanup = () => {
        clearTimeout(timeoutId);
        clearInterval(progressInterval);
        if (conn) conn.end();
      };

      conn.on('ready', () => {
        clearTimeout(timeoutId);
        console.log('SSH连接已建立');
        const startTime = Date.now();

        conn.sftp((err, sftp) => {
          if (err) {
            cleanup();
            return resolve({
              success: false,
              message: `SFTP初始化失败: ${err.message}`,
            });
          }

          // 获取远程文件信息
          sftp.stat(remotePath, (statErr, stats) => {
            if (statErr) {
              cleanup();
              return resolve({
                success: false,
                message: `远程文件不存在: ${remotePath}`,
              });
            }

            const totalSize = stats.size;
            console.log(`开始下载: ${remotePath} (${this.formatFileSize(totalSize)})`);

            // 删除已存在的本地文件（如果需要）
            if (options.overwrite && fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
            }

            // 开始进度监控
            if (options.onProgress) {
              progressInterval = setInterval(() => {
                try {
                  if (fs.existsSync(localPath)) {
                    const currentSize = fs.statSync(localPath).size;
                    const progress = totalSize > 0 ? (currentSize / totalSize) * 100 : 0;

                    // 检查是否停滞
                    if (currentSize === lastSize) {
                      stallCount++;
                      if (stallCount >= maxStallCount) {
                        cleanup();
                        reject(new Error('下载进度停滞，可能网络中断'));
                        return;
                      }
                    } else {
                      stallCount = 0;
                      lastSize = currentSize;
                    }

                    // 计算下载速度
                    const speed = this.calculateSpeed(currentSize, startTime);

                    options.onProgress({
                      progress: Math.min(100, Math.round(progress * 100) / 100),
                      transferred: currentSize,
                      total: totalSize,
                      speed: speed
                    });
                  }
                } catch (progressErr) {
                  // 进度监控错误不中断下载
                  console.warn('进度监控错误:', progressErr.message);
                }
              }, options.progressInterval || 1000); // 默认1秒更新一次
            }

            // 开始下载
            sftp.fastGet(remotePath, localPath, (downloadErr) => {
              cleanup();

              if (downloadErr) {
                return reject(new Error(`文件下载失败: ${downloadErr.message}`));
              }

              // 最终验证
              const finalSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0;
              if (finalSize !== totalSize) {
                return reject(new Error(`文件大小不匹配: 期望 ${totalSize} bytes, 实际 ${finalSize} bytes`));
              }

              console.log(`下载完成: ${remotePath} -> ${localPath}`);
              resolve({
                success: true,
                message: `File downloaded successfully.`,
                localPath: localPath,
                fileSize: totalSize
              });
            });
          });
        });
      });

      conn.on('error', (err) => {
        cleanup();
        reject(new Error(`SSH连接错误: ${err.message}`));
      });

      // 开始连接
      try {
        conn.connect(sshConfig);
      } catch (connectErr) {
        cleanup();
        reject(new Error(`SSH连接初始化失败: ${connectErr.message}`));
      }
    });
  }

  // 辅助方法：计算下载速度
  calculateSpeed(currentSize, startTime = Date.now()) {
    const elapsedTime = (Date.now() - startTime) / 1000; // 秒
    if (elapsedTime === 0) return '0 B/s';

    const speed = currentSize / elapsedTime; // bytes per second
    return this.formatSpeed(speed);
  }

  // 辅助方法：格式化速度
  formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) {
      return `${Math.round(bytesPerSecond)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    } else {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }
  }

  // 辅助方法：格式化时间
  formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  // 辅助方法：格式化文件大小
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 统一文件处理入口
  async processFile(file_path, options = {}) {
    const {
      file_type = 'auto',
      start_line = 0,
      end_line = 10,
      max_line_length = 500
    } = options;

    try {
      // 自动检测文件类型
      let actualfile_type = file_type;
      if (file_type === 'auto') {
        const ext = path.extname(file_path).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
          actualfile_type = 'image';
        } else if (['.xls', '.xlsx'].includes(ext)) {
          actualfile_type = 'table';
        } else if (['.md'].includes(ext)) {
          actualfile_type = 'markdown';
        } else if (['.pdf'].includes(ext)) {
          actualfile_type = 'pdf';
        } else {
          actualfile_type = 'text';
        }
      }

      // 根据文件类型调用对应的处理函数
      switch (actualfile_type) {
        case 'image':
          return await this.processImage(file_path);
        case 'pdf':
          return await this.processPDF(file_path);
        case 'table':
          return await this.processTable(file_path, start_line, end_line, max_line_length);
        case 'markdown':
          return await this.processMarkdown(file_path, start_line, end_line, max_line_length);
        case 'text':
        default:
          return await this.processText(file_path, start_line, end_line, max_line_length);
      }
    } catch (err) {
      console.error('文件处理错误:', err);
      return {
        success: false,
        error: `File processing failed: ${err.message}`,
        content: '',
        metadata: {
          file_path,
          file_type: options.file_type || 'auto',
          processedAt: new Date().toISOString()
        }
      };
    }
  }

  // 图片处理方法
  async processImage(file_path) {
    try {
      const content = `![${path.basename(file_path)}](${file_path})`;
      return {
        success: true,
        content,
        metadata: {
          file_path,
          file_type: 'image',
          fileName: path.basename(file_path),
          processedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      console.error('图片处理错误:', err);
      return {
        success: false,
        error: `Image processing failed: ${err.message}`,
        content: '',
        metadata: {
          file_path,
          file_type: 'image',
          processedAt: new Date().toISOString()
        }
      };
    }
  }

  // PDF处理方法
  async processPDF(file_path) {
    try {
      const content = `![${path.basename(file_path)}](${file_path})`;
      return {
        success: true,
        content,
        metadata: {
          file_path,
          file_type: 'pdf',
          fileName: path.basename(file_path),
          processedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      console.error('图片处理错误:', err);
      return {
        success: false,
        error: `Image processing failed: ${err.message}`,
        content: '',
        metadata: {
          file_path,
          file_type: 'image',
          processedAt: new Date().toISOString()
        }
      };
    }
  }

  // 表格处理方法（支持Excel、CSV、TSV，流式处理大文件）
  async processTable(file_path, start_line = 1, end_line = 100, max_line_length = 500) {
    try {
      const fileExt = path.extname(file_path).toLowerCase();
      let totalRows = 0;
      let processedRows = 0;
      let headers = [];
      let markdown = '';

      // 处理Excel文件
      if (fileExt === '.xlsx' || fileExt === '.xls') {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(file_path);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // 获取总行数
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        totalRows = range.e.r + 1;

        // 计算实际处理范围
        const actualStart = Math.max(1, start_line);
        const actualEnd = end_line ? Math.min(end_line, totalRows) : totalRows;
        processedRows = Math.max(0, actualEnd - actualStart + 1);

        // 使用range参数限制读取范围，避免读取整个文件
        const excelRange = this.getExcelRange(actualStart, actualEnd, range.e.c);
        const json = XLSX.utils.sheet_to_json(worksheet, { range: excelRange });

        if (json.length === 0) {
          return this.createEmptyResponse(file_path, totalRows);
        }

        // 获取表头
        headers = Object.keys(json[0]);

        // 生成Markdown表格
        markdown = this.generateMarkdownTable(json, headers, max_line_length, totalRows, processedRows);

      }
      // 处理CSV/TSV文件（流式读取）
      else if (fileExt === '.csv' || fileExt === '.tsv') {
        const delimiter = fileExt === '.tsv' ? '\t' : ',';

        // 先获取总行数和表头
        const fileInfo = await this.getFileInfo(file_path, delimiter);
        totalRows = fileInfo.totalLines;
        headers = fileInfo.headers;

        // 计算实际处理范围
        const actualStart = Math.max(1, start_line);
        const actualEnd = end_line ? Math.min(end_line, totalRows) : totalRows;
        processedRows = Math.max(0, actualEnd - actualStart + 1);

        if (totalRows === 0) {
          return this.createEmptyResponse(file_path, totalRows);
        }

        // 流式读取并处理指定范围内的行
        const jsonData = await this.streamCSVFile(file_path, delimiter, actualStart, actualEnd, headers, max_line_length);
        markdown = this.generateMarkdownTable(jsonData, headers, max_line_length, totalRows, processedRows);

      } else {
        throw new Error(`不支持的文件格式: ${fileExt}`);
      }

      return {
        success: true,
        content: markdown,
        metadata: {
          file_path,
          file_type: 'table',
          fileName: path.basename(file_path),
          totalRows,
          processedRows,
          start_line: Math.max(1, start_line),
          end_line: end_line || totalRows,
          max_line_length,
          headers: headers,
          processedAt: new Date().toISOString()
        }
      };

    } catch (err) {
      console.error('表格处理错误:', err);
      return {
        success: false,
        error: `Table processing failed: ${err.message}`,
        content: '',
        metadata: {
          file_path,
          file_type: 'table',
          processedAt: new Date().toISOString()
        }
      };
    }
  }

  // 流式读取CSV文件
  async streamCSVFile(file_path, delimiter, start_line, end_line, headers, max_line_length) {
    return new Promise((resolve, reject) => {
      const results = [];
      let currentLine = 0;

      const fileStream = fs.createReadStream(file_path, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024
      });

      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        currentLine++;

        // 跳过开始行之前的行和表头行
        if (currentLine < start_line || currentLine === 1) {
          return;
        }

        // 检查是否超过结束行
        if (end_line && currentLine > end_line) {
          rl.close();
          return;
        }

        try {
          const values = this.parseCSVLine(line, delimiter);
          const row = {};

          headers.forEach((header, index) => {
            if (index < values.length) {
              row[header] = this.processCellValue(values[index], max_line_length);
            } else {
              row[header] = '';
            }
          });

          results.push(row);
        } catch (error) {
          console.warn(`第 ${currentLine} 行解析错误:`, error.message);
        }
      });

      rl.on('close', () => {
        resolve(results);
      });

      rl.on('error', reject);
      fileStream.on('error', reject);
    });
  }

  // 生成Markdown表格
  generateMarkdownTable(data, headers, max_line_length, totalRows, processedRows) {
    if (data.length === 0) {
      return "Empty table";
    }

    let markdown = '|';

    // 表头
    headers.forEach(header => {
      markdown += ` ${this.processCellValue(header, max_line_length)} |`;
    });
    markdown += '\n|';

    // 分隔线
    headers.forEach(() => {
      markdown += ' --- |';
    });
    markdown += '\n';

    // 表格内容
    data.forEach(row => {
      markdown += '|';
      headers.forEach(header => {
        const value = row[header] || '';
        markdown += ` ${this.processCellValue(value, max_line_length)} |`;
      });
      markdown += '\n';
    });

    // 添加省略提示（如果未处理完所有行）
    if (processedRows < totalRows) {
      markdown += '|';
      headers.forEach(() => {
        markdown += ` [仅显示前 ${processedRows} 行，共 ${totalRows} 行] |`;
      });
      markdown += '\n';
    }

    return markdown;
  }

  // 处理单元格值（截断过长内容）
  processCellValue(value, max_line_length) {
    if (value === null || value === undefined) return '';

    const strValue = String(value);
    if (strValue.length <= max_line_length) {
      return strValue;
    }

    // 截断并添加提示
    return strValue.substring(0, max_line_length) + '...';
  }

  // 创建空响应
  createEmptyResponse(file_path, totalRows) {
    return {
      success: true,
      content: "Empty table",
      metadata: {
        file_path,
        file_type: 'table',
        fileName: path.basename(file_path),
        totalRows,
        processedRows: 0,
        processedAt: new Date().toISOString()
      }
    };
  }

  // 获取Excel范围
  getExcelRange(start_line, end_line, max_col) {
    // Excel行号从1开始，且第一行是表头
    const startRow = Math.max(1, start_line);
    const endRow = Math.min(end_line, 1048576); // Excel最大行数

    const startCol = 'A';
    const endCol = String.fromCharCode(65 + max_col); // A-Z, AA-ZZ等

    return `${startCol}${startRow}:${endCol}${endRow}`;
  }

  // 获取文件信息
  async getFileInfo(file_path, delimiter) {
    return new Promise((resolve, reject) => {
      let totalLines = 0;
      let headers = [];

      const fileStream = fs.createReadStream(file_path);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        totalLines++;
        if (totalLines === 1) {
          headers = this.parseCSVLine(line, delimiter);
        }
        // 只读取第一行获取表头
        if (totalLines >= 1) {
          rl.close();
        }
      });

      rl.on('close', () => {
        // 重新打开文件统计总行数（减去表头）
        this.countFileLines(file_path).then(lineCount => {
          resolve({
            totalLines: Math.max(0, lineCount - 1), // 减去表头行
            headers: headers
          });
        });
      });

      rl.on('error', reject);
    });
  }

  // 解析CSV行
  parseCSVLine(line, delimiter) {
    // 简化的CSV解析，处理基本情况和引号
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  // 统计文件行数
  countFileLines(file_path) {
    return new Promise((resolve, reject) => {
      let lineCount = 0;
      fs.createReadStream(file_path)
        .on('data', (buffer) => {
          let idx = -1;
          do {
            idx = buffer.indexOf(10, idx + 1);
            if (idx !== -1) lineCount++;
          } while (idx !== -1);
        })
        .on('end', () => resolve(lineCount))
        .on('error', reject);
    });
  }

  // 文本处理方法
  async processText(file_path, start_line, end_line, max_line_length) {
    try {
      const fileStream = fs.createReadStream(file_path, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024 // 64KB chunks
      });

      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      const processedLines = [];
      let currentLine = 0;
      let totalLines = 0;

      for await (const line of rl) {
        totalLines++;

        if (currentLine >= start_line && (end_line === 0 || currentLine < end_line)) {
          // Process line length if needed
          if (line.length > max_line_length) {
            processedLines.push(line.substring(0, max_line_length) + ' [Output truncated due to length]... ');
          } else {
            processedLines.push(line);
          }
        }

        currentLine++;

        // Stop reading if we've reached end_line
        if (end_line > 0 && currentLine >= end_line) {
          break;
        }
      }

      let result = processedLines.join('\n');
      const processedLineCount = processedLines.length;

      // Add truncation notice if needed
      if (end_line > 0 && totalLines > end_line) {
        result += '\n[Output truncated due to length]...';
      }

      const markdownContent = `\`\`\`text\n${result}\n\`\`\`\n\n`;

      return {
        success: true,
        content: markdownContent,
        metadata: {
          file_path,
          file_type: 'text',
          fileName: path.basename(file_path),
          totalLines,
          processedLineCount,
          start_line,
          end_line,
          max_line_length,
          processedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      console.error('文本处理错误:', err);
      return {
        success: false,
        error: `Text processing failed: ${err.message}`,
        content: '',
        metadata: {
          file_path,
          file_type: 'text',
          processedAt: new Date().toISOString()
        }
      };
    }
  }

  // Markdown文件处理方法
  async processMarkdown(file_path, start_line, end_line, max_line_length) {
    try {
      const content = fs.readFileSync(file_path, 'utf8');

      // 处理每行长度，超过限制的截断并添加...
      const lines = content.split('\n');
      const processedLines = lines.map(line => {
        if (line.length > max_line_length) {
          return line.substring(0, max_line_length) + ' [Output truncated due to length]... ';
        }
        return line;
      });

      let result;
      const totalLines = processedLines.length;
      const processedLineCount = Math.min(totalLines - start_line, end_line - start_line);

      if (totalLines <= end_line) {
        // 行数不多，全部显示
        result = processedLines.slice(start_line, totalLines).join('\n');
      } else {
        // 显示指定范围内的行
        result = processedLines.slice(start_line, end_line).join('\n');
        // 添加省略行
        result += '\n[Output truncated due to length]...';
      }

      return {
        success: true,
        content: result,
        metadata: {
          file_path,
          file_type: 'markdown',
          fileName: path.basename(file_path),
          totalLines,
          processedLineCount,
          start_line,
          end_line,
          max_line_length,
          processedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      console.error('Markdown处理错误:', err);
      return {
        success: false,
        error: `Markdown processing failed: ${err.message}`,
        content: '',
        metadata: {
          file_path,
          file_type: 'markdown',
          processedAt: new Date().toISOString()
        }
      };
    }
  }

  // 主处理方法
  async display(file_path, start_line = 0, end_line = 10, max_line_length = 500, file_type = 'auto') {
    const sshConfig = utils.getSshConfig();
    // const sshConfig = null;

    // 如果SSH配置为空，使用本地文件处理
    if (!sshConfig?.enabled || !sshConfig || !sshConfig?.host) {
      const result = await this.processFile(file_path, {
        file_type,
        start_line,
        end_line,
        max_line_length
      });

      // 添加本地文件链接
      if (result.success) {
        result.content += '\n\n[Local file](' + file_path + ')';
      }
      return result;
    } else {
      // 否则使用远程文件处理
      const tempPath = path.join(this.local_path, path.basename(file_path));
      WindowManager?.instance?.mainWindow?.window?.webContents.send('upload-progress', { state: "start" });
      const fileInfo = await this.downloadViaSSHWithProgress(
        file_path,
        tempPath,
        {
          onProgress: (progress) => {
            console.log(
              `进度: ${progress.progress}% | ` +
              `已下载: ${this.formatFileSize(progress.transferred)}/${this.formatFileSize(progress.total)} | ` +
              `速度: ${progress.speed}`
            );
            WindowManager?.instance?.mainWindow?.window?.webContents.send('upload-progress', { state: "progress", progress: progress.progress })
          },
          progressInterval: 2000, // 2秒更新一次
          timeout: 60 * 60 * 1000, // 60分钟超时
          overwrite: true // 覆盖已存在文件
        }
      );
      WindowManager?.instance?.mainWindow?.window?.webContents.send('upload-progress', { state: "end", file_path })
      console.log('下载信息:', fileInfo);

      const result = await this.processFile(tempPath, {
        file_type,
        start_line,
        end_line,
        max_line_length
      });

      // 添加文件信息
      if (result.success) {
        result.content += '\n\n- Remote file: ' + file_path;
        result.content += '\n\n- Local file: [' + tempPath + '](' + tempPath + ')';
      }
      return result;
    }
  }
}

DisplayFile.instance = null;

function main(params) {
  return async function ({ file_path, start_line = 0, end_line = 10, max_line_length = 500, file_type = 'auto' }) {
    const display = new DisplayFile(params?.local_path);
    const result = await display.display(file_path, start_line, end_line, max_line_length, file_type);

    // 返回统一格式的JSON响应
    if (result.success) {
      return result.content;
    } else {
      return `Error: ${result.error}`;
    }
  }
}

function getPrompt() {
  const prompt = `## display_file
Description: Display or read various file types (images, tables, text) in Markdown format and download files via SSH.
- When to use this tool  
  - When you need to view a table or text file  
  - When you need to display results to the user
- Supported file types:
  - Images: .png, .jpg, .jpeg, .gif, .svg
  - PDF: .pdf
  - Tables: .xls, .xlsx
  - Text: .txt, .csv, .tsv, .md

Parameters:
- file_path: (Required) Path to the file to be displayed or read
- start_line: Starting line number for text display (default: 0).
- end_line: Ending line number for text display (default: 10).
- max_line_length: Maximum character length per line or cell for text/tables (default: 500).

Usage:
{
  "thinking": "[Record the absolute path of the file to be displayed/read in detail]",
  "tool": "display_file",
  "params": {
    "file_path": "[file-path]",
    "start_line": [start_line],
    "end_line": [end_line],
    "max_line_length": [max_line_length]
  }
}`;
  return prompt;
}

if (require.main === module) {
  // 当直接运行此文件时，执行调试测试
  (async () => {
    try {
      // 示例用法
      const result = await main()({
        file_path: '/tmp/exp_genes_md5_c49ca96a258c4112c42131ab9ec45990.csv'
      });
      console.log('调试结果:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('调试错误:', error);
    }
  })();
}

module.exports = {
  main,
  getPrompt
};