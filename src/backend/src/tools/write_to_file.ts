import * as fs from 'fs';
import * as path from 'path';

// --- 类型定义 ---
export interface WriteToFileParams {
    file_path: string;
    content?: string;
}

export async function main({ file_path, content = '' }: WriteToFileParams): Promise<string> {
    try {
        if (!file_path) {
            throw new Error("file_path is required");
        }

        const dir = path.dirname(file_path);
        
        // 如果目录不存在，则递归创建目录
        if (!fs.existsSync(dir)) {
            // 使用同步或异步均可，这里保持创建目录的连贯性
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // 修复：使用 fs.promises.writeFile 替代错误的 await fs.writeFileSync
        await fs.promises.writeFile(file_path, content, 'utf8');
        
        return `File ${file_path} saved successfully`;
    } catch (error: any) {
        return `File ${file_path} save failed: ${error.message}`;
    }
}

export function getPrompt() {
    return {
        "name": "write_to_file",
        "description": "Writes text content to files (UTF-8 only) with automatic path handling",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute destination path (required)"
                },
                "content": {
                    "type": "string",
                    "description": "Text content to write (supports multiline)"
                }
            },
            "required": [
                "file_path"
            ]
        }
    };
}