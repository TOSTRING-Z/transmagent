import * as fs from 'fs';

// 定义输入参数接口
export interface ReplaceParams {
    file_path: string;
    diff: string;
}

export function main() {
    return async ({ file_path, diff }: ReplaceParams): Promise<string> => {
        try {
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
                return `File ${file_path} not modified: The content in SEARCH block may not exactly match the actual content in the file or the replacement is identical`;
            }

            fs.writeFileSync(file_path, content);
            return `File ${file_path} modified successfully`;
        } catch (error: any) {
            return `File ${file_path} modification failed: ${error.message}`;
        }
    }
}

export function getPrompt() {
    return {
        "name": "replace_in_file",
        "description": "Precisely replace file content strictly using the SEARCH/REPLACE pattern. This tool is intended for code refactoring, bug fixing, or updating configurations.",
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
[Exact existing code snippet in the file]
=======
[New code snippet to replace it with]
>>>>>>> REPLACE

Critical Rules:
1. **Exact Match**: The content in the SEARCH block must perfectly match the existing file content, including all spaces, indentation, and line breaks.
2. **Uniqueness**: Include enough context lines in the SEARCH block to ensure the match is unique within the file.
3. **Atomicity**: If multiple disconnected changes are needed, provide multiple consecutive SEARCH/REPLACE blocks. Do not bundle unrelated changes into one massive block.
4. **Conciseness**: Only include the specific parts that need changing along with the necessary context. Do NOT put the entire file content into the block.

Example:
<<<<<<< SEARCH
    const a = 10;
=======
    const a = 20;
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