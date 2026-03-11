import * as fs from 'fs';
import * as path from 'path';

// --- 类型定义 ---
export interface WriteToFileParams {
    file_path: string;
    content?: string;
}

export function main() {
    return async ({ file_path, content = '' }: WriteToFileParams): Promise<string> => {
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
}

export function getPrompt() {
    return {
        "name": "write_to_file",
        "description": "Creates a new file or completely OVERWRITES an existing file with the provided text content. \n\nCRITICAL WARNING: This tool replaces the entire file. Do NOT use this tool for partial modifications or minor edits to existing files; use the 'replace_in_file' tool instead.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute or relative destination path. Missing parent directories will be created automatically."
                },
                "content": {
                    "type": "string",
                    "description": "The COMPLETE text content to write. This will fully replace any existing content in the target file. Must be UTF-8 encoded."
                }
            },
            "required": [
                "file_path",
                "content"
            ]
        }
    };
}