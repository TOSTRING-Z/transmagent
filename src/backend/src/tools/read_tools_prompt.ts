import { existsSync, readFileSync } from "fs";
import { utils } from "../utils/globals";
import { WindowManager } from "../main/windows/WindowManager";

// --- 类型定义 ---
export interface ReadToolsParams {
    tool_names?: string[];
}

export function getPrompt() {
    return {
        name: "read_tools_prompt",
        description: "Retrieve the `tool core description file` content along with MCP tools. Optionally filter by specific tool names.",
        parameters: {
            type: "object",
            properties: {
                tool_names: {
                    type: "array",
                    items: {
                        type: "string"
                    },
                    description: "Optional list of specific tool names to retrieve. If empty or omitted, returns all tools."
                }
            },
            required: [] // 参数设为可选，以便支持无参调用获取全量工具
        }
    }
}

export function main() {
    return async (params?: ReadToolsParams): Promise<any> => {
        // 获取参数，默认为空数组
        const tool_names = params?.tool_names || [];
        
        const mcp_client = WindowManager.instance.mainWindow.tool_call.mcp_client;
        await mcp_client.initMcp();
        const mcp_prompt = mcp_client.mcpPrompt;
        const mcp_tool_prompts = mcp_client.toolPrompts; // 这是一个 Record<string, string>
        
        const prompt_file = utils.getConfig("tool_call")?.cli_prompt || utils.getDefault("prompts/cli_prompt.md");
        
        if (!existsSync(prompt_file)) {
            return "The tool core description file does not exist";
        }

        const fileContent = readFileSync(prompt_file, 'utf-8');

        // 如果没有传入特定的工具名，直接返回完整的文档内容
        if (tool_names.length === 0) {
            return {
                bash_tools: fileContent,
                mcp_tools: mcp_prompt
            };
        }

        // --- 逐行解析提取指定 Bash 工具逻辑 ---
        const lines = fileContent.split('\n');
        let extractedTools: string[] = [];
        let currentToolName: string | null = null;
        let currentToolLines: string[] = [];

        // 匹配工具名的正则：如 "- tool_name:"，并提取组 1 中的工具名
        const toolStartRegex = /^- ([a-zA-Z0-9_-]+):/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            const match = line.match(toolStartRegex);
            
            // 检查是否遇到新的工具定义 (不能是子级缩进)
            if (match && !line.startsWith('  - ') && !line.startsWith('    - ')) {
                // 在开始新工具前，先检查并保存上一个工具的内容（如果匹配的话）
                if (currentToolName && tool_names.includes(currentToolName)) {
                    extractedTools.push(currentToolLines.join('\n').trim());
                }
                
                // 开始记录新工具
                currentToolName = match[1];
                currentToolLines = [line];
            } else if (currentToolName) {
                // 当前正在记录某个工具的区块内
                currentToolLines.push(line);
                
                // 遇到显式的终止符 "***" 时，结束当前工具的记录
                if (trimmedLine === '***') {
                    if (tool_names.includes(currentToolName)) {
                        extractedTools.push(currentToolLines.join('\n').trim());
                    }
                    currentToolName = null; // 重置状态
                    currentToolLines = [];
                }
            }
        }

        // 捕捉文件末尾的最后一个工具 (如果文件最后没有 *** 结尾)
        if (currentToolName && tool_names.includes(currentToolName)) {
            extractedTools.push(currentToolLines.join('\n').trim());
        }

        const matchedBashTools = extractedTools.length > 0 
            ? extractedTools.join('\n\n') 
            : `No matching bash tools found for: ${tool_names.join(', ')}.`;

        // --- 提取指定的 MCP 工具逻辑 ---
        const extractedMcpTools: string[] = [];
        for (const name of tool_names) {
            if (mcp_tool_prompts[name]) {
                // 找到对应的 MCP 工具，推入数组
                extractedMcpTools.push(mcp_tool_prompts[name]);
            }
        }

        // 拼接提取出的 MCP 文档结果，使用 "---" 分隔保持格式统一
        const matchedMcpTools = extractedMcpTools.length > 0
            ? extractedMcpTools.join('\n\n---\n\n')
            : `No matching MCP tools found for: ${tool_names.join(', ')}.`;

        return {
            bash_tools: matchedBashTools,
            mcp_tools: matchedMcpTools
        };
    }
}