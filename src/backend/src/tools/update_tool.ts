import * as fs from 'fs';
import { logger } from '../utils/logger';
import { ToolCall } from '../core/ToolCall';

// --- 类型定义 ---
export interface UpdateToolParams {
    tool_name: string;
    tool_documentation: string;
    toolCall: ToolCall;
}

export interface UpdateToolResult {
    success: boolean;
    action?: 'updated' | 'added';
    tool?: string;
    message?: string;
    error?: string;
}

export function main() {
    return async (params: UpdateToolParams): Promise<UpdateToolResult> => {
        try {
            const { tool_name, tool_documentation, toolCall } = params;

            if (!tool_name || !tool_documentation) {
                throw new Error("Both tool_name and tool_documentation parameters are required");
            }

            // 安全获取 prompt 配置文件路径
            const prompt_file = toolCall.utils.getConfig("tool_call").cli_prompt || toolCall.utils.getDefault("prompts/cli_prompt.md");

            if (!fs.existsSync(prompt_file)) {
                // 如果文件不存在，初始化一个空文件
                fs.writeFileSync(prompt_file, '', 'utf8');
            }

            // 读取当前 CLI prompt 文件
            let content = fs.readFileSync(prompt_file, 'utf8');

            // 使用逐行分析的方法来精确匹配工具部分
            const lines = content.split('\n');
            let inTargetTool = false;
            let toolStartIndex = -1;
            let toolEndIndex = -1;

            // 匹配工具名的正则，支持字母、数字、下划线和连字符
            const newToolRegex = /^- [a-zA-Z0-9_-]+:/;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmedLine = line.trim();

                // 检查是否找到目标工具的开始
                if (line.startsWith(`- ${tool_name}:`)) {
                    inTargetTool = true;
                    toolStartIndex = i;
                    continue;
                }

                if (inTargetTool) {
                    // 如果遇到***，则工具结束
                    if (trimmedLine === '***') {
                        toolEndIndex = i;
                        break;
                    }

                    // 如果是空行，检查下一行是否是新的工具
                    if (trimmedLine === '') {
                        if (i + 1 < lines.length) {
                            const nextLine = lines[i + 1];
                            if (newToolRegex.test(nextLine)) {
                                toolEndIndex = i;
                                break;
                            }
                        }
                        continue;
                    }

                    // 检查是否遇到新的工具（非当前工具的缩进内容）
                    if (newToolRegex.test(line) && !line.startsWith('  - ') && !line.startsWith('    - ')) {
                        toolEndIndex = i;
                        break;
                    }
                }
            }

            // 如果找到了工具开始但没找到结束，说明工具在文件末尾
            if (inTargetTool && toolEndIndex === -1) {
                toolEndIndex = lines.length;
            }

            if (toolStartIndex !== -1) {
                logger.log('找到现有工具，进行更新...');

                // 构建替换后的内容
                const beforeTool = lines.slice(0, toolStartIndex).join('\n');
                const afterTool = toolEndIndex !== -1 ? lines.slice(toolEndIndex).join('\n') : '';

                // 清理前后的多余空行
                const cleanBeforeTool = beforeTool.trimEnd();
                let cleanAfterTool = afterTool;

                if (cleanAfterTool.startsWith('\n\n')) {
                    cleanAfterTool = cleanAfterTool.substring(2);
                } else if (cleanAfterTool.startsWith('\n')) {
                    cleanAfterTool = cleanAfterTool.substring(1);
                }

                // 构建最终内容，确保只有一个空行分隔
                content = cleanBeforeTool + '\n\n' + tool_documentation.trim();
                if (cleanAfterTool) {
                    content += '\n\n' + cleanAfterTool;
                }

            } else {
                logger.log('未找到现有工具，添加到文件末尾...');
                const cleanContent = content.trimEnd();
                content = cleanContent + (cleanContent ? '\n\n' : '') + tool_documentation.trim();
            }

            // 将更新后的内容写回文件
            fs.writeFileSync(prompt_file, content, 'utf8');

            return {
                success: true,
                action: toolStartIndex !== -1 ? 'updated' : 'added',
                tool: tool_name,
                message: `Tool '${tool_name}' has been ${toolStartIndex !== -1 ? 'updated' : 'added'} successfully`
            };

        } catch (error: any) {
            logger.error(`Update tool failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export function getPrompt() {
    return {
        "name": "update_tool",
        "description": "Updates or adds a tool's documentation in the \`tool core description file\`. This instructs the AI on how to use the tool in future turns. Always provide the full, updated documentation block.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_name": {
                    "type": "string",
                    "description": "The exact name of the tool (e.g., 'test_tool', 'replace_in_file')."
                },
                "tool_documentation": {
                    "type": "string",
                    "description": `The complete Markdown documentation block for the tool. 
                    
MUST strictly follow this exact nested list format and indentation (use spaces, NOT tabs):
- [tool_name]: [Brief description of the tool's purpose]
  - Input: [Describe inputs, e.g., \`file_path\` (required)]
  - Output: [Describe outputs, e.g., Success/Error message]
  - Use: [Provide an example of how to invoke it, e.g., JSON payload or command]
  - Note:
    - [Constraint or tip 1]
    - [Constraint or tip 2]

Critical Rules:
1. The first line MUST start with '- tool_name:'.
2. Sub-items (Input, Output, Use, Note) MUST be indented with exactly 2 spaces.
3. Sub-notes MUST be indented with exactly 4 spaces.
4. Do not include markdown code block backticks (\`\`\`markdown) around the entire output, just provide the raw text.`
                }
            },
            "required": [
                "tool_name",
                "tool_documentation"
            ]
        }
    };
}