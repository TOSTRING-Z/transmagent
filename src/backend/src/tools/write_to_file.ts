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
// --- 大模型 Prompt 提示词 ---
export function getPrompt() {
    return {
        "name": "write_to_file",
        "description": `Writes text content to the specified file path.

🛠️ Write Modes:
1. **overwrite** (default): Completely replaces the file content. Use for new files or full rewrites of small files.
2. **append**: Adds content to the exact End-Of-File (EOF). Use for logs, or CONTINUING a long file write.

🚨 TRUNCATION & ANTI-LOOP PROTOCOL (CRITICAL) 🚨
LLMs have strict output token limits. Attempting to write a massive file (>300 lines) in one go WILL result in truncation (text being cut off mid-execution).
- PREVENT: If the script is very long, intentionally chunk it. Call this tool with mode='overwrite' for part 1, then call again with mode='append' for part 2.
- RECOVER: If your last 'write_to_file' call was truncated, YOU MUST NOT USE 'overwrite' AGAIN. Re-overwriting will cause an infinite loop. Instead, immediately call 'write_to_file' with mode='append' and provide ONLY the missing remaining code, starting exactly where the previous write stopped.
- MODIFY: To change a few lines in a large file, NEVER use this tool. Use 'replace_in_file' to prevent accidentally wiping out code.`,
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative destination path. Missing parent directories are created automatically."
                },
                "content": {
                    "type": "string",
                    "description": "The exact text to write or append. If recovering from truncation, only include the missing remaining text."
                },
                "mode": {
                    "type": "string",
                    "description": "Must be 'overwrite' or 'append'. Default is 'overwrite'.",
                    "enum": ["overwrite", "append"],
                    "default": "overwrite"
                }
            },
            "required": ["file_path", "content"],
            "additionalProperties": false
        }
    };
}