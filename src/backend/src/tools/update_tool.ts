// @ts-nocheck
const fs = require('fs');
const { utils } = require('../utils/globals');

async function main({ tool_name, tool_documentation }) {
    try {
        if (!tool_name || !tool_documentation) {
            throw new Error("Both tool_name and tool_documentation parameters are required");
        }

        const prompt_file = utils.getConfig("tool_call").cli_prompt || utils.getDefault("cli_prompt.md");
        
        // Read the current CLI prompt file
        let content = fs.readFileSync(prompt_file, 'utf8');
        
        // 使用逐行分析的方法来精确匹配工具部分
        const lines = content.split('\n');
        let inTargetTool = false;
        let toolStartIndex = -1;
        let toolEndIndex = -1;

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
                        // 如果下一行是新的工具（以 "- toolname:" 格式），则当前工具结束
                        if (nextLine.match(/^- \w+:/)) {
                            toolEndIndex = i;
                            break;
                        }
                    }
                    continue;
                }
                
                // 检查是否遇到新的工具（非当前工具的缩进内容）
                if (line.match(/^- \w+:/) && !line.startsWith('  - ') && !line.startsWith('    - ')) {
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
            console.log('找到现有工具，进行更新...');
            console.log('工具位置:', toolStartIndex, '到', toolEndIndex);
            
            // 构建替换后的内容
            const beforeTool = lines.slice(0, toolStartIndex).join('\n');
            const afterTool = toolEndIndex !== -1 ? lines.slice(toolEndIndex).join('\n') : '';
            
            // 清理前后的多余空行
            const cleanBeforeTool = beforeTool.trimEnd();
            let cleanAfterTool = afterTool;
            
            // 如果afterTool以空行开始，去掉开头的空行
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
            console.log('未找到现有工具，添加到文件末尾...');
            // Tool doesn't exist - directly append to the end of file
            // 清理末尾的多余空行后再添加
            const cleanContent = content.trimEnd();
            content = cleanContent + '\n\n' + tool_documentation.trim();
        }
        
        // Write updated content back to file
        fs.writeFileSync(prompt_file, content, 'utf8');
        
        return {
            success: true,
            action: toolStartIndex !== -1 ? 'updated' : 'added',
            tool: tool_name,
            message: `Tool '${tool_name}' has been ${toolStartIndex !== -1 ? 'updated' : 'added'} successfully`
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

function getPrompt() {
    return {
    "name": "update_tool",
    "description": "Update or add tool documentation in the CLI prompt configuration file. If the tool exists, updates its usage documentation; if not, adds the new tool at the end of the file.",
    "parameters": {
        "type": "object",
        "properties": {
            "tool_name": {
                "type": "string",
                "description": "(Required) Name of the tool to update or add"
            },
            "tool_documentation": {
                "type": "string",
                "description": "(Required) Complete documentation for the tool usage, MUST strictly follow the exact format below"
            }
        },
        "required": [
            "tool_name",
            "tool_documentation"
        ]
    }
};
}

// 测试函数
if (require.main === module) {
  // 当直接运行此文件时，执行调试测试
  (async () => {
    try {
      // 示例用法 - 测试添加新工具
      const result = await main({
        tool_name: "test_tool",
        tool_documentation: `- test_tool: This is a test tool for debugging
  - Input: \`input.txt\` (test input file)
  - Output: \`output.txt\` (test output file)  
  - Use: \`echo "test command"\`
  - Note:
    - This is a test note
    - For debugging purposes only`
      });
      console.log('调试结果:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('调试错误:', error);
    }
  })();
}

export {
    main, getPrompt
};