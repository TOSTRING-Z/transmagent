import * as path from 'path';
import { promises as fs } from 'fs'; // 切换为异步 Promises API
import { logger } from '../utils/logger';
import { Client, ConnectConfig } from 'ssh2';
import { ToolCall } from '../core/ToolCall';

export interface FindFilesParams {
    dir_path: string;
    file_pattern: string;
    toolCall: ToolCall;
}

/**
 * 封装底层的 ssh2 执行逻辑 (保持不变，本身就是异步的)
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

                stream.on('close', (code: number, signal: any) => {
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

export function main() {
    return async ({ dir_path, file_pattern, toolCall }: FindFilesParams): Promise<string[] | string> => {
        const MAX_FILES = 200;
        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

        try {
            // ================= 1. SSH 远程模式 =================
            if (isRemote) {
                logger.info(`[find_files] Running in SSH mode against ${sshConfig.host}`);
                const namePattern = file_pattern.replace(/\*\*\//g, '');
                const cmd = `find "${dir_path}" -type f -name "${namePattern}" | head -n ${MAX_FILES + 1}`;
                
                const stdout = await executeRemoteCommand(cmd, toolCall);

                let files = stdout.split('\n').map(f => f.trim()).filter(Boolean);
                if (files.length > MAX_FILES) {
                    files = files.slice(0, MAX_FILES);
                    files.push(`... (truncated, more files hidden)`);
                }
                return files;
            }

            // ================= 2. 本地执行模式 (已完成非阻塞改造) =================
            logger.info(`[find_files] Running in Local mode`);
            const resolvedTarget = path.resolve(dir_path);
            
            // ✅ 修复点 1：使用异步的 fs.stat 代替 fs.statSync
            const stats = await fs.stat(resolvedTarget);
            
            if (!stats.isDirectory()) {
                throw new Error(`Target must be a directory: ${resolvedTarget}`);
            }

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const globModule = require('glob');
            const globOptions = { cwd: resolvedTarget, nodir: true, absolute: false };

            let files: string[] = [];

            // ✅ 修复点 2：彻底移除同步的 globSync/sync 调用，一律封装为纯异步的 Promise 形式
            if (typeof globModule.glob === 'function') {
                files = await globModule.glob(file_pattern, globOptions);
            } else {
                // 兼容老版本 glob 的异步回调模式
                files = await new Promise<string[]>((resolve, reject) => {
                    globModule(file_pattern, globOptions, (err: any, matches: string[]) => {
                        if (err) reject(err);
                        else resolve(matches);
                    });
                });
            }

            if (files.length > MAX_FILES) {
                files = files.slice(0, MAX_FILES);
                files.push(`... (truncated, ${files.length - MAX_FILES} more files hidden)`);
            }

            return files;
        } catch (error: any) {
            logger.error(`Find files error: ${error.message}`);
            return `Error: ${error.message}`;
        }
    };
}

export function getPrompt() {
    return {
        "name": "find_files",
        "description": "Find file paths in a directory using a glob pattern. Use this to explore directory structures or find specific files before reading them. Returns up to 200 relative paths.",
        "parameters": {
            "type": "object",
            "properties": {
                "dir_path": {
                    "type": "string",
                    "description": "(required): starting directory path, absolute or relative"
                },
                "file_pattern": {
                    "type": "string",
                    "description": "(required): glob pattern. Examples: \"**/*\" (all files), \"src/**/*.ts\", \"*.env\""
                }
            },
            "required": ["dir_path", "file_pattern"]
        }
    };
}