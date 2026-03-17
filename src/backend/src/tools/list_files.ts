import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { logger } from '../utils/logger';
import { utils } from '../utils/globals';

// --- 类型定义 ---
export interface ListFilesParams {
    threshold?: number;
}

export interface ListFilesArgs {
    path: string;
    recursive?: boolean;
    regex?: string | null;
}

// 过滤规则配置
const EXCLUDE_PATTERNS: RegExp[] = [
    // IDE config
    /\/\.vscode\//i,
    /\/\.idea\//i,
    // Cache
    /\/\.cache\//i,
    /\/\.npm\//i,
    /\/\.git\//i, // 建议追加对 git 目录的过滤
    // Media
    /\.(gif|png|jpe?g|mp4|mov|avi)$/i,
    // Binaries
    /\.(exe|dll|so|a)$/i,
    // Documents
    /\.(pptx?)$/i,
];

/**
 * 判断是否命中过滤黑名单
 * @param filePath 绝对路径
 * @param isDir 是否为目录
 */
function shouldExclude(filePath: string, isDir: boolean): boolean {
    let normalized = filePath.replace(/\\/g, '/');
    if (isDir && !normalized.endsWith('/')) {
        normalized += '/';
    }
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(normalized));
}

export function main(params: ListFilesParams = {}) {
    return async (args: ListFilesArgs): Promise<string[]> => {
        const threshold = params.threshold || 50;
        const regexObj = args.regex ? new RegExp(args.regex) : null;
        const result: string[] = [];

        const sshConfig = utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

        // ==========================================
        // 1. 远程 SSH 遍历逻辑
        // ==========================================
        if (isRemote) {
            return new Promise((resolve) => {
                const conn = new Client();
                const cleanup = () => { if (conn) conn.end(); };

                conn.on('ready', () => {
                    conn.sftp(async (err, sftp) => {
                        if (err) {
                            cleanup();
                            return resolve([`SFTP Error: ${err.message}`]);
                        }

                        // 异步递归扫描函数
                        async function scanRemote(currentPath: string) {
                            if (result.length > threshold) return;

                            let items: any[];
                            try {
                                items = await new Promise((res, rej) => {
                                    sftp.readdir(currentPath, (readErr, list) => {
                                        if (readErr) rej(readErr); else res(list);
                                    });
                                });
                            } catch (e: any) {
                                logger.warn(`Failed to read remote directory ${currentPath}: ${e.message}`);
                                return;
                            }

                            for (const item of items) {
                                if (result.length > threshold) return;

                                // SFTP 有时会返回 . 和 ..，需要显式跳过
                                if (item.filename === '.' || item.filename === '..') continue;

                                // 远端环境默认使用 POSIX 路径拼接规范
                                const fullPath = path.posix.join(currentPath, item.filename);
                                const isDir = item.attrs.isDirectory();

                                if (shouldExclude(fullPath, isDir)) {
                                    continue;
                                }

                                if (!regexObj || regexObj.test(item.filename)) {
                                    result.push(fullPath);
                                }

                                if (isDir && args.recursive) {
                                    await scanRemote(fullPath);
                                }
                            }
                        }

                        try {
                            // 格式化传入的路径以适配远端 Linux 系统
                            const targetPath = args.path.replace(/\\/g, '/');
                            await scanRemote(targetPath);
                            
                            cleanup();

                            if (result.length > threshold) {
                                resolve(['Too much content returned, please try another solution!']);
                            } else {
                                resolve(result);
                            }
                        } catch (error: any) {
                            cleanup();
                            resolve([`Remote Scan Error: ${error.message}`]);
                        }
                    });
                }).on('error', (err) => {
                    cleanup();
                    resolve([`SSH Connection Error: ${err.message}`]);
                }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
            });
        }

        // ==========================================
        // 2. 本地遍历逻辑
        // ==========================================
        function scanLocal(currentPath: string) {
            if (result.length > threshold) return;

            let items: string[];
            try {
                items = fs.readdirSync(currentPath);
            } catch (err: any) {
                logger.warn(`Failed to read directory ${currentPath}: ${err.message}`);
                return;
            }

            for (const item of items) {
                if (result.length > threshold) return;

                const fullPath = path.join(currentPath, item);
                let stat: fs.Stats;

                try {
                    stat = fs.statSync(fullPath);
                } catch (e) {
                    continue; 
                }

                if (shouldExclude(fullPath, stat.isDirectory())) {
                    continue;
                }

                if (!regexObj || regexObj.test(item)) {
                    result.push(fullPath);
                }

                if (stat.isDirectory() && args.recursive) {
                    scanLocal(fullPath);
                }
            }
        }

        try {
            const targetPath = path.resolve(args.path);
            if (!fs.existsSync(targetPath)) {
                throw new Error(`Path does not exist: ${targetPath}`);
            }

            scanLocal(targetPath);

            if (result.length > threshold) {
                return ['Too much content returned, please try another solution!'];
            }

            return result;
        } catch (error: any) {
            logger.error(`Error listing files in ${args.path}: ${error.message}`);
            return [error.message];
        }
    };
}

export function getPrompt(): string {
    return `# list_files  
Description: Recursively scans directories with intelligent filtering (automatically excludes dev/binary files). Automatically supports Local and SSH remote environments.  

Parameters:  
- path: Target directory absolute path (required). For remote files, ensure the SSH session is active.
- recursive: Enable subdirectory scanning (default=false)  
- regex: Filename pattern filter (optional)  

Auto-excluded:  
- IDE configs (.vscode/, .idea/)  
- Cache dirs (.cache/, .npm/, .git/)  
- Media/binaries (.gif, .png, .mp4, .exe, etc)  

Best Practices:  
1. Disable recursion for large directories  
2. Use precise regex (e.g. \\.js$)

Usage:  
{
  "thinking": "[Thinking process]",
  "tool": "list_files",
  "params": {
    "path": "/project/src",
    "recursive": false,
    "regex": null
  }
}`;
}

// 本地调试入口
if (require.main === module) {
    (async () => {
        try {
            const runner = main({ threshold: 50 });
            // 如果你在此处想测试 SSH，需要提前 mock utils.getSshConfig() 
            const result = await runner({
                path: process.cwd(),
                recursive: false,
                regex: null
            });
            logger.log('调试结果:', JSON.stringify(result, null, 2));
        } catch (error: any) {
            console.error('调试错误:', error);
        }
    })();
}