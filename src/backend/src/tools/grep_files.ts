import * as fsNative from 'fs';
import { promises as fs } from 'fs'; // 用于异步文件元数据操作
import * as path from 'path';
import * as readline from 'readline';
import { logger } from '../utils/logger';
import { Client, ConnectConfig } from 'ssh2';
import { ToolCall } from '../core/ToolCall';

export interface GrepFilesParams {
    target_files: string[];
    regex: string;
    timeout_ms?: number;
    toolCall: ToolCall;
}

export interface SearchResult {
    file: string;
    match: string;
    context: string;
    line: number;
}

/**
 * 封装底层的 ssh2 执行逻辑
 */
async function executeRemoteCommand(cmd: string, toolCall: ToolCall): Promise<string> {
    const sshConfig = toolCall.utils.getSshConfig();
    if (!sshConfig || !sshConfig.host) {
        throw new Error("Missing SSH configuration");
    }

    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.exec(cmd, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                let stdout = '';
                let stderr = '';

                stream.on('close', (code: number) => {
                    conn.end();
                    if (code > 1 && stderr && !stdout) {
                        return reject(new Error(`Remote command failed (code ${code}): ${stderr}`));
                    }
                    resolve(stdout);
                }).on('data', (data: Buffer) => {
                    stdout += data.toString();
                }).stderr.on('data', (data: Buffer) => {
                    stderr += data.toString();
                });
            });
        }).on('error', (err) => {
            reject(new Error(`SSH Connection Error: ${err.message}`));
        });

        conn.connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
    });
}

// ✅ 修复点 1：将文本/二进制文件的安全检测完全改造为非阻塞异步函数
async function isTextFile(filePath: string): Promise<boolean> {
    const ext = path.extname(filePath).toLowerCase();

    const BINARY_EXTENSIONS = new Set([
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', 
        '.mp3', '.wav', '.flac', '.aac', '.ogg',        
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', 
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
        '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',   
        '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc', '.wasm' 
    ]);
    if (BINARY_EXTENSIONS.has(ext)) return false;

    const TEXT_EXTENSIONS = new Set([
        '.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.less',
        '.vue', '.svelte', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift',
        '.sql', '.sh', '.bat', '.ps1', '.yaml', '.yml', '.ini', '.env', '.xml', '.svg', '.csv', '.log', '.conf', '.toml', '.graphql'
    ]);
    if (TEXT_EXTENSIONS.has(ext)) return true;

    let fileHandle: fsNative.promises.FileHandle | null = null;
    try {
        // 使用异步打开文件句柄
        fileHandle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        
        // 异步读取文件前 4KB 字节
        const { bytesRead } = await fileHandle.read(buffer, 0, 4096, 0);
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) return false; // 包含空字节，判定为二进制
        }
        return true; 
    } catch (error: any) {
        return false; 
    } finally {
        if (fileHandle !== null) {
            try { await fileHandle.close(); } catch (e) {}
        }
    }
}

export function main() {
    return async ({ target_files, regex, timeout_ms = 20000, toolCall }: GrepFilesParams): Promise<SearchResult[] | string> => {
        const MAX_RESULTS = 100;
        const validFiles = target_files.filter(f => !f.includes('... (truncated'));
        if (validFiles.length === 0) return "Error: No valid target files provided.";

        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

        try {
            // ================= 1. SSH 远程模式 =================
            if (isRemote) {
                logger.info(`[grep_files] Running in SSH mode against ${sshConfig.host}`);
                const safeRegex = regex.replace(/'/g, "'\\''");
                const filesArg = validFiles.map(f => `"${f}"`).join(' ');
                const cmd = `grep -nHE '${safeRegex}' ${filesArg} | head -n ${MAX_RESULTS}`;
                
                const stdout = await executeRemoteCommand(cmd, toolCall);
                
                const results: SearchResult[] = [];
                if (stdout) {
                    const lines = stdout.split('\n').filter(Boolean);
                    for (const lineStr of lines) {
                        const firstColon = lineStr.indexOf(':');
                        const secondColon = lineStr.indexOf(':', firstColon + 1);
                        
                        if (firstColon > -1 && secondColon > -1) {
                            const file = lineStr.substring(0, firstColon);
                            const lineNum = parseInt(lineStr.substring(firstColon + 1, secondColon), 10);
                            const context = lineStr.substring(secondColon + 1).trim();

                            results.push({
                                file: file, 
                                match: "Matched in text", 
                                context: context.substring(0, 200),
                                line: lineNum || 0
                            });
                        }
                    }
                }
                return results;
            }

            // ================= 2. 本地执行模式 (已完成非阻塞改造) =================
            logger.info(`[grep_files] Running in Local mode`);
            const startTime = Date.now();
            const results: SearchResult[] = [];
            const MAX_FILE_SIZE = 5 * 1024 * 1024; 
            
            let regexObj: RegExp;
            try {
                // 解析内联修饰符，例如 (?i)hello → /hello/gi
                let flags = 'g';
                let pattern = regex;
                const inlineFlagMatch = regex.match(/^\(\?([i]+)\)/);
                if (inlineFlagMatch) {
                    flags += inlineFlagMatch[1];
                    pattern = regex.slice(inlineFlagMatch[0].length);
                }
                regexObj = new RegExp(pattern, flags);
            } catch (err: any) {
                return `Error: Invalid Regular Expression - ${err.message}`;
            }

            let globalTimeoutReached = false;

            for (const fileItem of validFiles) {
                if (globalTimeoutReached || results.length >= MAX_RESULTS) break;

                const file = path.resolve(fileItem);

                try {
                    // ✅ 修复点 2：使用异步的 fs.stat 检查文件大小
                    const stat = await fs.stat(file);
                    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) continue;
                } catch (e) { continue; }

                // ✅ 修复点 3：通过 await 挂起当前文件的文本类型检测，让出主线程控制权
                if (!(await isTextFile(file))) continue;

                try {
                    // 创建可读流以行读取（天然的非阻塞 I/O 块）
                    const fileStream = fsNative.createReadStream(file, { encoding: 'utf8' });
                    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
                    let currentLine = 0;

                    for await (const line of rl) {
                        currentLine++;
                        if (Date.now() - startTime > timeout_ms) {
                            globalTimeoutReached = true;
                            rl.close();
                            break;
                        }

                        regexObj.lastIndex = 0;
                        let match;
                        while ((match = regexObj.exec(line)) !== null) {
                            if (match[0].length === 0) { regexObj.lastIndex++; continue; }

                            const start = Math.max(0, match.index - 20);
                            const end = Math.min(line.length, match.index + match[0].length + 20);
                            
                            results.push({
                                file: file, 
                                match: match[0].substring(0, 150),
                                context: line.substring(start, end).trim(),
                                line: currentLine
                            });

                            if (results.length >= MAX_RESULTS) { rl.close(); break; }
                        }
                        if (results.length >= MAX_RESULTS) break;
                    }
                } catch (e) {
                    logger.warn(`Failed to grep ${file}`);
                }
            }
            return results;

        } catch (error: any) {
            return `Grep files error: ${error.message}`;
        }
    };
}

export function getPrompt() {
    return {
        "name": "grep_files",
        "description": "Search for regex matches within a SPECIFIC list of files. Use this after using find_files. It reads the files line-by-line and returns the matches with context.",
        "parameters": {
            "type": "object",
            "properties": {
                "target_files": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "(required): Array of FULL/ABSOLUTE file paths to search inside (max 50 recommended)."
                },
                "regex": {
                    "type": "string",
                    "description": "(required): The regular expression to match."
                }
            },
            "required": ["target_files", "regex"]
        }
    };
}