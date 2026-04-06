import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { ToolCall } from '../core/ToolCall';

/**
 * 工业级文件写入工具 (精简版)
 * * 核心逻辑：
 * 1. 极简的 Overwrite & Append 模式，完美契合大模型“自回归”天性。
 * 2. 遇到 Token 截断时，大模型在下一轮可自然而然地使用 mode='append' 续写。
 * 3. 统一本地与 SSH 远程支持，自动处理不存在的父级目录。
 * 4. 无状态 (Stateless) 设计，完全规避进程重启或执行中断导致的状态机错乱问题。
 */

// --- 类型定义 ---
export interface WriteToFileParams {
    file_path: string;
    content?: string;
    mode?: 'overwrite' | 'append';
    toolCall: ToolCall;
}

// 本地文件操作
async function writeLocalFile(filePath: string, content: string, mode: 'overwrite' | 'append'): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (mode === 'append' && fs.existsSync(filePath)) {
        await fs.promises.appendFile(filePath, content, 'utf8');
    } else {
        await fs.promises.writeFile(filePath, content, 'utf8');
    }
}

// 远程SSH文件操作
async function writeRemoteFile(filePath: string, content: string, mode: 'overwrite' | 'append', sshConfig: any): Promise<void> {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            // 1. 强制在远端创建父级目录
            const dirName = path.posix.dirname(filePath);
            conn.exec(`mkdir -p "${dirName}"`, (execErr, stream) => {
                if (execErr) {
                    conn.end();
                    return reject(new Error(`Failed to create remote directory: ${execErr.message}`));
                }

                stream.on('close', () => {
                    // 2. 目录创建完毕，开启 SFTP
                    conn.sftp((err, sftp) => {
                        if (err) {
                            conn.end();
                            return reject(new Error(`SFTP error: ${err.message}`));
                        }

                        // 3. 使用原生 flag 处理覆盖与追加
                        const writeOptions: { encoding: BufferEncoding; flag: string } = mode === 'append' 
                            ? { encoding: 'utf8', flag: 'a' } 
                            : { encoding: 'utf8', flag: 'w' };
                        
                        sftp.writeFile(filePath, content, writeOptions, (writeErr) => {
                            conn.end();
                            if (writeErr) reject(new Error(`Remote write error: ${writeErr.message}`));
                            else resolve();
                        });
                    });
                }).on('data', () => {}).stderr.on('data', () => {});
            });
        }).on('error', (err) => {
            reject(new Error(`SSH connection error: ${err.message}`));
        }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
    });
}

// --- 主执行逻辑 ---
export function main() {
    return async (params: WriteToFileParams): Promise<string> => {
        try {
            const { file_path, content = '', mode = 'overwrite', toolCall } = params;

            if (!file_path) {
                throw new Error("file_path is required");
            }

            const sshConfig = toolCall.utils.getSshConfig();
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

            if (isRemote) {
                await writeRemoteFile(file_path, content, mode, sshConfig);
            } else {
                await writeLocalFile(file_path, content, mode);
            }

            return `File ${file_path} saved successfully (mode: ${mode}).`;
        } catch (error: any) {
            return `File save failed: ${error.message}`;
        }
    };
}

// --- 大模型 Prompt 提示词 ---
export function getPrompt() {
    return {
        "name": "write_to_file",
        "description": `Writes text content to a local or remote file.

Write Modes:
1. **overwrite** (default): Replaces the entire file with the new content. Used for creating new files or fully rewriting existing ones.
2. **append**: Adds the content to the very end of an existing file. Perfect for adding new lines, logs, or continuing a file that was too long to write in one go due to length limits.

CRITICAL PIPELINE RULES:
- If your script/file is extremely long and gets cut off, simply call this tool again with mode='append' to continue writing the rest of the content.
- If you are making partial, surgical edits to the middle of an existing file, DO NOT use this tool. Use the 'replace_in_file' tool instead to avoid wiping out existing code.`,
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative destination path. Missing parent directories are created automatically."
                },
                "content": {
                    "type": "string",
                    "description": "The text content to write or append."
                },
                "mode": {
                    "type": "string",
                    "description": "Write mode: 'overwrite' or 'append'.",
                    "enum": ["overwrite", "append"],
                    "default": "overwrite"
                }
            },
            "required": ["file_path"],
            "additionalProperties": false
        }
    };
}