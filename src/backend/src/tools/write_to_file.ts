import { finished } from 'stream/promises';
import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { logger } from '../utils/logger';
import { utils } from '../utils/globals';
import * as os from 'os';

/**
 * 工业级文件写入工具 - 解决工具参数截断问题
 *
 * 核心问题：当调用工具时，Bash指令或文件内容参数可能因Token限制被截断
 *
 * 解决方案：
 * 1. 分片写入模式：将长内容拆分为多个chunk，通过session_id关联
 *    - 模型分多次调用，每次传递一个chunk
 *    - 服务端维护会话状态，收集所有chunk后合并写入
 *    - 避免单次调用参数过长
 *
 * 2. 追加模式：支持多次追加写入，避免覆盖已有内容
 *
 * 3. SSH远程支持：自动检测SSH配置，支持远程文件写入
 *    - 参考list_files.ts的SSH实现模式
 *    - 统一本地/远程API，对调用者透明
 *
 * 设计原则：
 * - 向后兼容：原有单次写入API保持不变
 * - 渐进增强：支持新功能但不强制使用
 * - 状态管理：会话状态在内存中，生产环境应使用外部存储
 * - 错误恢复：提供清晰的错误消息和状态反馈
 */

// --- 类型定义 ---
export interface WriteToFileParams {
    file_path: string;
    content?: string;
    mode?: 'overwrite' | 'append';
    session_id?: string;
    chunk_index?: number;
    total_chunks?: number;
}

// 会话状态管理（内存中，单次工具调用生命周期内有效）
// 注意：实际生产环境应使用外部存储如Redis或文件系统持久化
interface ChunkSession {
    filePath: string;
    tempDir: string;
    receivedChunks: Set<number>;
    totalChunks: number;
}

const chunkSessions = new Map<string, ChunkSession>();

// 远程大文件流式上传 (利用 sftp.fastPut 防止 OOM)
async function uploadRemoteFile(localFilePath: string, remoteFilePath: string, sshConfig: any): Promise<void> {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            const dirName = path.posix.dirname(remoteFilePath);
            // 确保远程目录存在
            conn.exec(`mkdir -p "${dirName}"`, (execErr, stream) => {
                if (execErr) {
                    conn.end();
                    return reject(new Error(`Failed to create remote directory: ${execErr.message}`));
                }

                stream.on('close', () => {
                    conn.sftp((err, sftp) => {
                        if (err) {
                            conn.end();
                            return reject(new Error(`SFTP error: ${err.message}`));
                        }

                        // fastPut 是处理大文件的最佳实践，自带流式传输和并发控制
                        sftp.fastPut(localFilePath, remoteFilePath, (putErr) => {
                            conn.end();
                            if (putErr) reject(new Error(`Remote upload error: ${putErr.message}`));
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

// 清理临时目录函数
async function cleanupTempDir(tempDir: string) {
    try {
        if (fs.existsSync(tempDir)) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    } catch (error) {
        logger.warn(`Failed to cleanup temp dir ${tempDir}: ${error}`);
    }
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
            // 1. 强制在远端创建父级目录 (解决报错问题)
            const dirName = path.posix.dirname(filePath); // 远程通常是 posix 路径
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

                        // 3. 使用原生 flag 处理追加，坚决不能全量读取！
                        const writeOptions = mode === 'append' ? { encoding: 'utf8', flag: 'a' } : { encoding: 'utf8', flag: 'w' };
                        
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

// 分片写入处理
async function handleChunkWrite(params: WriteToFileParams, isRemote: boolean, sshConfig: any): Promise<string> {
    const { file_path, content = '', session_id, chunk_index, total_chunks } = params;

    if (!session_id || chunk_index === undefined || total_chunks === undefined) {
        throw new Error('For chunked write, session_id, chunk_index, and total_chunks are required');
    }

    // 移除了 isRemote 的抛错拦截！

    const safeSessionId = session_id.replace(/[^a-zA-Z0-9_-]/g, '');
    let session = chunkSessions.get(safeSessionId);
    
    if (!session) {
        // 无论本地还是远程写入，分片都先暂存在本地临时目录
        // 远程模式下，不要用 path.dirname(file_path)，因为 file_path 是远程路径
        const baseTempDir = isRemote ? os.tmpdir() : path.dirname(file_path);
        const tempDir = path.join(baseTempDir, `.chunk_session_${safeSessionId}`);
        fs.mkdirSync(tempDir, { recursive: true });

        session = {
            filePath: file_path,
            tempDir,
            receivedChunks: new Set<number>(),
            totalChunks: total_chunks
        };
        chunkSessions.set(safeSessionId, session);
    }

    if (chunk_index < 0 || chunk_index >= total_chunks) {
        throw new Error(`Invalid chunk_index: ${chunk_index}, must be between 0 and ${total_chunks - 1}`);
    }

    const chunkFileName = path.join(session.tempDir, `chunk_${chunk_index}.part`);
    await fs.promises.writeFile(chunkFileName, content);
    session.receivedChunks.add(chunk_index);

    if (session.receivedChunks.size === total_chunks) {
        // 如果是远程，合并到一个本地临时文件；如果是本地，直接合并到目标文件
        const mergeTargetFile = isRemote ? path.join(session.tempDir, 'merged_final.tmp') : file_path;

        try {
            const writeStream = fs.createWriteStream(mergeTargetFile, { flags: 'w' });
            
            for (let i = 0; i < total_chunks; i++) {
                const chunkFile = path.join(session.tempDir, `chunk_${i}.part`);
                const chunkBuffer = await fs.promises.readFile(chunkFile); 
                
                if (!writeStream.write(chunkBuffer)) {
                    await new Promise<void>(resolve => writeStream.once('drain', () => resolve()));
                }
            }
            writeStream.end();
            await finished(writeStream);

            // 如果是远程模式，利用 fastPut 将合并好的大文件推送到服务器
            if (isRemote) {
                await uploadRemoteFile(mergeTargetFile, file_path, sshConfig);
            }

        } finally {
            await cleanupTempDir(session.tempDir);
            chunkSessions.delete(safeSessionId);
        }

        const envPrefix = isRemote ? "Remote file" : "Local file";
        return `${envPrefix} ${file_path} saved successfully from ${total_chunks} chunks.`;
    } else {
        return `Chunk ${chunk_index + 1}/${total_chunks} received. Waiting for remaining chunks.`;
    }
}

export function main() {
    return async (params: WriteToFileParams): Promise<string> => {
        try {
            const { file_path, content = '', mode = 'overwrite', session_id, chunk_index, total_chunks } = params;

            if (!file_path) {
                throw new Error("file_path is required");
            }

            const sshConfig = utils?.getSshConfig ? utils.getSshConfig() : null;
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

            // 分片写入处理
            if (session_id !== undefined || chunk_index !== undefined || total_chunks !== undefined) {
                return await handleChunkWrite(params, isRemote, sshConfig);
            }

            // 常规写入处理
            if (isRemote) {
                await writeRemoteFile(file_path, content, mode, sshConfig);
            } else {
                await writeLocalFile(file_path, content, mode);
            }

            return `File ${file_path} saved successfully (mode: ${mode})`;
        } catch (error: any) {
            return `File save failed: ${error.message}`;
        }
    };
}

export function getPrompt() {
    return {
        "name": "write_to_file",
        "description": `Writes content to a file with support for chunked uploads.

## Modes:
1. **Single write** (default): Provide file_path and content for immediate write.
2. **Append mode**: Set mode='append' to add content to end of existing file.
3. **Chunked write**: For large content that exceeds token limits, use session_id, chunk_index, and total_chunks to split content across multiple calls.

## Chunked Write Protocol:
- First call: Provide session_id (any unique string), chunk_index=0, total_chunks=N
- Subsequent calls: Use same session_id with chunk_index=1..N-1
- Tool automatically merges chunks when all received
- Each chunk must be complete and in correct order

CRITICAL: For partial modifications to existing files, prefer 'replace_in_file' tool.`,
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative destination path. Missing parent directories created automatically."
                },
                "content": {
                    "type": "string",
                    "description": "Text content to write. For chunked writes, this is a single chunk's content."
                },
                "mode": {
                    "type": "string",
                    "description": "Write mode: 'overwrite' (default) or 'append'.",
                    "enum": ["overwrite", "append"],
                    "default": "overwrite"
                },
                "session_id": {
                    "type": "string",
                    "description": "Unique identifier for chunked write session. Required for chunked writes."
                },
                "chunk_index": {
                    "type": "number",
                    "description": "Zero-based index of this chunk. Required for chunked writes. CRITICAL: Chunks can be sent in any order, but the tool will wait until all chunks (0 to total_chunks-1) are received before combining."
                },
                "total_chunks": {
                    "type": "number",
                    "description": "Total number of chunks in session. Required for chunked writes."
                }
            },
            "required": [
                "file_path"
            ],
            "additionalProperties": false
        }
    };
}