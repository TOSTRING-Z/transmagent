import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { logger } from '../utils/logger';
import { utils } from '../utils/globals';

// 定义输入参数接口
export interface ReplaceParams {
    file_path: string;
    diff: string;
}

// 读取远程文件内容
async function readRemoteFile(filePath: string, sshConfig: any): Promise<string> {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(new Error(`SFTP error: ${err.message}`));
                }

                sftp.readFile(filePath, 'utf8', (readErr, data) => {
                    conn.end();
                    if (readErr) {
                        reject(new Error(`Failed to read remote file ${filePath}: ${readErr.message}`));
                    } else {
                        resolve(data);
                    }
                });
            });
        }).on('error', (err) => {
            conn.end();
            reject(new Error(`SSH connection error: ${err.message}`));
        }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
    });
}

// 写入远程文件内容
async function writeRemoteFile(filePath: string, content: string, sshConfig: any): Promise<void> {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(new Error(`SFTP error: ${err.message}`));
                }

                sftp.writeFile(filePath, content, 'utf8', (writeErr) => {
                    conn.end();
                    if (writeErr) {
                        reject(new Error(`Failed to write remote file ${filePath}: ${writeErr.message}`));
                    } else {
                        resolve();
                    }
                });
            });
        }).on('error', (err) => {
            conn.end();
            reject(new Error(`SSH connection error: ${err.message}`));
        }).connect({ ...sshConfig, readyTimeout: 20000 } as ConnectConfig);
    });
}

// 本地文件替换逻辑（与原有逻辑相同）
function replaceInLocalFile(file_path: string, diff: string): string {
    // 读取原始文件内容
    const originalContent = fs.readFileSync(file_path, 'utf8');
    let content = originalContent;

    // 更健壮的块分割处理
    const blocks = diff.split(/<<<<<<< SEARCH/g);
    blocks.shift(); // 移除第一个空元素 (分割标识符前的内容)

    blocks.forEach(block => {
        // 确保包含必要的分隔符
        if (!block.includes('=======') || !block.includes('>>>>>>> REPLACE')) {
            throw new Error('Invalid diff format: missing "=======" or ">>>>>>> REPLACE"');
        }

        const [search, replaceBlock] = block.split(/=======/);
        const searchContent = search.trim();
        const replaceContent = replaceBlock.split(/>>>>>>> REPLACE/)[0].trim();

        // 更精确的内容匹配
        if (!content.includes(searchContent)) {
            throw new Error(`Search content not found: "${searchContent.replace(/\n/g, '\\n')}"`);
        }

        // 执行替换 (注意：这里只会替换第一个完全匹配的字符串)
        content = content.replace(searchContent, replaceContent);
    });

    if (content === originalContent) {
        throw new Error(`File not modified: The content in SEARCH block may not exactly match the actual content in the file or the replacement is identical`);
    }

    fs.writeFileSync(file_path, content);
    return `File ${file_path} modified successfully`;
}

// 远程文件替换逻辑
async function replaceInRemoteFile(file_path: string, diff: string, sshConfig: any): Promise<string> {
    // 读取远程文件内容
    const originalContent = await readRemoteFile(file_path, sshConfig);
    let content = originalContent;

    // 更健壮的块分割处理
    const blocks = diff.split(/<<<<<<< SEARCH/g);
    blocks.shift(); // 移除第一个空元素 (分割标识符前的内容)

    blocks.forEach(block => {
        // 确保包含必要的分隔符
        if (!block.includes('=======') || !block.includes('>>>>>>> REPLACE')) {
            throw new Error('Invalid diff format: missing "=======" or ">>>>>>> REPLACE"');
        }

        const [search, replaceBlock] = block.split(/=======/);
        const searchContent = search.trim();
        const replaceContent = replaceBlock.split(/>>>>>>> REPLACE/)[0].trim();

        // 更精确的内容匹配
        if (!content.includes(searchContent)) {
            throw new Error(`Search content not found: "${searchContent.replace(/\n/g, '\\n')}"`);
        }

        // 执行替换 (注意：这里只会替换第一个完全匹配的字符串)
        content = content.replace(searchContent, replaceContent);
    });

    if (content === originalContent) {
        throw new Error(`File not modified: The content in SEARCH block may not exactly match the actual content in the file or the replacement is identical`);
    }

    // 写回远程文件
    await writeRemoteFile(file_path, content, sshConfig);
    return `File ${file_path} modified successfully`;
}

export function main() {
    return async ({ file_path, diff }: ReplaceParams): Promise<string> => {
        try {
            // 获取SSH配置并判断是否为远程文件
            const sshConfig = utils?.getSshConfig ? utils.getSshConfig() : null;
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

            if (isRemote) {
                // 远程文件替换
                return await replaceInRemoteFile(file_path, diff, sshConfig);
            } else {
                // 本地文件替换
                return replaceInLocalFile(file_path, diff);
            }
        } catch (error: any) {
            return `File ${file_path} modification failed: ${error.message}`;
        }
    }
}

export function getPrompt() {
    return {
        "name": "replace_in_file",
        "description": `Precisely replace file content strictly using the SEARCH/REPLACE pattern. This tool is intended for code refactoring, bug fixing, or updating configurations.

Critical Rules:
1. **Exact Match**: The content in the SEARCH block must perfectly match the existing file content, including all spaces, indentation, and line breaks.
2. **Uniqueness**: Include enough context lines in the SEARCH block to ensure the match is unique within the file.
3. **Atomicity**: If multiple disconnected changes are needed, provide multiple consecutive SEARCH/REPLACE blocks. Do not bundle unrelated changes into one massive block.
4. **Conciseness**: Only include the specific parts that need changing along with the necessary context. Do NOT put the entire file content into the block.`,
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative path to the target file (required)."
                },
                "diff": {
                    "type": "string",
                    "description": `Replacement blocks must strictly follow this format:
<<<<<<< SEARCH
[Exact existing code_1 snippet in the file_]
=======
[New code_1 snippet to replace it with]
>>>>>>> REPLACE
<<<<<<< SEARCH
[Exact existing code_N snippet in the file]
=======
[New code_N snippet to replace it with]
>>>>>>> REPLACE`
                }
            },
            "required": [
                "file_path",
                "diff"
            ]
        }
    };
}