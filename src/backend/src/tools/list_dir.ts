import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { logger } from '../utils/logger';
import { ToolCall } from '../core/ToolCall';

export interface ListFilesParams {
    threshold?: number;
    timeoutMs?: number;
}

export interface ListFilesArgs {
    path: string;
    recursive?: boolean;
    regex?: string | null;
    toolCall: ToolCall;
}

const EXCLUDE_PATTERNS: RegExp[] = [
    /\/(node_modules|venv|\.venv|env)\//i,
    /\/\.vscode\//i,
    /\/\.idea\//i,
    /\/\.npm\//i,
    /\/\.git\//i,
    /\/\.next\//i, 
];

// 优化：假设传入的已经是 normalized（POSIX风格）的路径，不再重复执行 replace
function shouldExclude(normalizedPath: string, isDir: boolean): boolean {
    const checkPath = isDir && !normalizedPath.endsWith('/') ? `${normalizedPath}/` : normalizedPath;
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(checkPath));
}

export function main(params: ListFilesParams = {}) {
    return async (args: ListFilesArgs): Promise<string[]> => {
        const threshold = params.threshold || 150;
        const timeoutMs = params.timeoutMs || 10000;
        const toolCall = args.toolCall;
        const result: string[] = [];

        // 1. 防御非法正则表达式
        let regexObj: RegExp | null = null;
        if (args.regex) {
            try {
                regexObj = new RegExp(args.regex, 'i');
            } catch (err: any) {
                return [`Error: Invalid regex pattern - ${err.message}`];
            }
        }

        let limitReached = false;
        let isTimedOut = false;
        let sshClient: Client | null = null;

        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

        // 核心清理逻辑，确保无论如何都不泄露资源
        const cleanup = () => {
            if (sshClient) {
                sshClient.end();
                sshClient = null;
            }
        };

        // ==========================================
        // 核心扫描逻辑封装
        // ==========================================
        async function performScan(): Promise<void> {
            if (isRemote) {
                return new Promise<void>((resolve, reject) => {
                    sshClient = new Client();
                    
                    sshClient.on('ready', () => {
                        sshClient!.sftp(async (err, sftp) => {
                            if (err) return reject(new Error(`SFTP Error: ${err.message}`));

                            // 将 SFTP readdir 包装成 Promise
                            const readdirAsync = (dir: string) => new Promise<any[]>((res, rej) => {
                                sftp.readdir(dir, (readErr, list) => readErr ? rej(readErr) : res(list));
                            });

                            async function scanRemote(currentPath: string) {
                                if (limitReached || isTimedOut) return;

                                let items: any[];
                                try {
                                    items = await readdirAsync(currentPath);
                                } catch (e: any) {
                                    logger.warn(`Failed to read remote dir ${currentPath}: ${e.message}`);
                                    return;
                                }

                                for (const item of items) {
                                    if (limitReached || isTimedOut) return;
                                    if (item.filename === '.' || item.filename === '..') continue;

                                    // 统一使用 posix 拼接
                                    const fullPath = path.posix.join(currentPath, item.filename);
                                    const isDir = item.attrs.isDirectory();
                                    
                                    if (item.attrs.isSymbolicLink() || shouldExclude(fullPath, isDir)) continue;

                                    if (!regexObj || regexObj.test(fullPath)) {
                                        result.push(fullPath);
                                        if (result.length >= threshold) {
                                            limitReached = true;
                                            return;
                                        }
                                    }

                                    if (isDir && args.recursive) {
                                        await scanRemote(fullPath);
                                    }
                                }
                            }

                            try {
                                const targetPath = args.path.replace(/\\/g, '/');
                                await scanRemote(targetPath);
                                resolve();
                            } catch (error) {
                                reject(error);
                            }
                        });
                    }).on('error', (err) => {
                        reject(new Error(`SSH Connection Error: ${err.message}`));
                    }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
                });
            } else {
                // 本地执行模式
                async function scanLocal(currentPath: string) {
                    if (limitReached || isTimedOut) return;

                    let items: fs.Dirent[];
                    try {
                        items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                    } catch (err: any) {
                        logger.warn(`Failed to read directory ${currentPath}: ${err.message}`);
                        return;
                    }

                    for (const item of items) {
                        if (limitReached || isTimedOut) return;

                        // 本地路径统一转为 POSIX 风格以便于跨平台统一过滤和输出
                        const rawPath = path.join(currentPath, item.name);
                        const normalizedPath = rawPath.replace(/\\/g, '/');
                        const isDir = item.isDirectory();

                        if (item.isSymbolicLink() || shouldExclude(normalizedPath, isDir)) continue;

                        if (!regexObj || regexObj.test(normalizedPath)) {
                            result.push(normalizedPath);
                            if (result.length >= threshold) {
                                limitReached = true;
                                return;
                            }
                        }

                        if (isDir && args.recursive) {
                            await scanLocal(rawPath); // 传参给下一层用原生 path，提高兼容性
                        }
                    }
                }

                const targetPath = path.resolve(args.path);
                try {
                    await fs.promises.access(targetPath);
                } catch {
                    throw new Error(`Path does not exist or access denied: ${targetPath}`);
                }
                
                await scanLocal(targetPath);
            }
        }

        // ==========================================
        // 调度控制：竞速执行 (Promise.race 解决 I/O 卡死)
        // ==========================================
        let watchdogObj: NodeJS.Timeout;
        const timeoutPromise = new Promise<void>((_, reject) => {
            watchdogObj = setTimeout(() => {
                isTimedOut = true;
                reject(new Error('TIMEOUT_GRACEFUL'));
            }, timeoutMs);
        });

        try {
            // 用 Promise.race 保证即便底层网络库死锁，也能按时脱身
            await Promise.race([performScan(), timeoutPromise]);
        } catch (error: any) {
            if (error.message !== 'TIMEOUT_GRACEFUL') {
                logger.error(`Error listing files in ${args.path}: ${error.message}`);
                result.push(`Execution Error: ${error.message}`);
            }
        } finally {
            clearTimeout(watchdogObj!);
            cleanup(); // 必须断开底层连接

            if (isTimedOut) {
                logger.warn(`[ListFiles] Scan timed out after ${timeoutMs}ms for path: ${args.path}`);
                result.push(`... [WARNING: Output truncated. Scan timed out after ${timeoutMs}ms. The directory tree is too large or the storage is too slow. Please narrow your search path.]`);
            } else if (limitReached) {
                result.push(`... [WARNING: Output truncated. Reached maximum limit of ${threshold} items. Please use a stricter regex or avoid root directory scanning.]`);
            }
        }

        return result;
    };
}

export function getPrompt() {
    return {
        "name": "list_dir",
        "description": "Recursively scans directories with intelligent filtering. Automatically excludes node_modules, .git, and binary files. Has a built-in execution timeout and item limit to prevent overwhelming the context.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Target directory absolute path (required)."
                },
                "recursive": {
                    "type": "boolean",
                    "description": "Enable subdirectory scanning. Default is false. CAUTION: Use with care in large directories.",
                    "default": false
                },
                "regex": {
                    "type": "string",
                    "description": "Pattern to match against the FULL file path (e.g., '\\\\.ts$' or 'src/.*\\\\.js$'). Case-insensitive by default."
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }
    };
}