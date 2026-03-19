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

/**
 * 核心补丁应用函数 (纯函数，易于单元测试)
 * 解决了缩进丢失和换行符不匹配的痛点
 */
function applyPatch(originalContent: string, diff: string): string {
    // 统一将所有换行符归一化为 \n，消除 \r\n 带来的严格匹配失败问题
    let content = originalContent.replace(/\r\n/g, '\n');
    const normalizedDiff = diff.replace(/\r\n/g, '\n');

    const blocks = normalizedDiff.split(/<<<<<<< SEARCH\n?/);
    blocks.shift(); // 移除第一个空元素

    if (blocks.length === 0) {
        throw new Error('Invalid diff format: No SEARCH blocks found. Make sure to use <<<<<<< SEARCH.');
    }

    blocks.forEach((block, index) => {
        if (!block.includes('=======') || !block.includes('>>>>>>> REPLACE')) {
            throw new Error(`Invalid diff format in block ${index + 1}: missing "=======" or ">>>>>>> REPLACE"`);
        }

        // 使用正则提取，而不是 trim()，这样可以完美保留代码的前导缩进和内部空格
        // 这里的 \n? 是为了吃掉标记符自带的那一个换行
        const searchMatch = block.match(/([\s\S]*?)\n?=======\n?/);
        const replaceMatch = block.match(/=======\n?([\s\S]*?)\n?>>>>>>> REPLACE/);

        if (!searchMatch || !replaceMatch) {
            throw new Error(`Failed to parse SEARCH or REPLACE content in block ${index + 1}`);
        }

        const searchContent = searchMatch[1];
        const replaceContent = replaceMatch[1];

        if (!content.includes(searchContent)) {
            // 提取前 50 个字符用于报错提示，避免日志被撑爆
            const snippet = searchContent.substring(0, 50).replace(/\n/g, '\\n') + '...';
            throw new Error(`Search content not found in block ${index + 1}: "${snippet}". Ensure exact match including whitespace and comments.`);
        }

        // 仅替换第一个匹配项
        content = content.replace(searchContent, replaceContent);
    });

    if (content === originalContent.replace(/\r\n/g, '\n')) {
        throw new Error(`File not modified: The replacement is identical to the existing content.`);
    }

    return content;
}

// 瘦身后的本地文件替换逻辑
function replaceInLocalFile(file_path: string, diff: string): string {
    const originalContent = fs.readFileSync(file_path, 'utf8');
    const updatedContent = applyPatch(originalContent, diff);
    fs.writeFileSync(file_path, updatedContent, 'utf8');
    return `File ${file_path} modified successfully`;
}

// 瘦身后的远程文件替换逻辑
async function replaceInRemoteFile(file_path: string, diff: string, sshConfig: any): Promise<string> {
    const originalContent = await readRemoteFile(file_path, sshConfig);
    const updatedContent = applyPatch(originalContent, diff);
    await writeRemoteFile(file_path, updatedContent, sshConfig);
    return `File ${file_path} modified successfully`;
}

export function main() {
    return async ({ file_path, diff }: ReplaceParams): Promise<string> => {
        try {
            if (!file_path || !diff) {
                throw new Error("Both file_path and diff parameters are required.");
            }

            const sshConfig = utils?.getSshConfig ? utils.getSshConfig() : null;
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);

            if (isRemote) {
                return await replaceInRemoteFile(file_path, diff, sshConfig);
            } else {
                return replaceInLocalFile(file_path, diff);
            }
        } catch (error: any) {
            return `File modification failed: ${error.message}`;
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