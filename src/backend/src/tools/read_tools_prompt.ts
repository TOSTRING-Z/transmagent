import { existsSync, readFileSync } from "fs";
import { ToolCall } from "../core/ToolCall";

// --- 类型定义 ---
export interface ReadToolsParams {
    tool_names?: string[];
    skill_names?: string[]; // 新增：用于筛选特定的 Skill
    toolCall: ToolCall;
}

export function getPrompt() {
    return {
        name: "read_tools_prompt",
        description: "Retrieve the `tool core description file` content, MCP tools, and active Agent Skills. Optionally filter by specific tool names or skill names.",
        parameters: {
            type: "object",
            properties: {
                tool_names: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional list of specific tool names to retrieve. If empty or omitted, returns all tools."
                },
                skill_names: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional list of specific skill names to retrieve. If empty or omitted, returns all active skills."
                }
            },
            required: []
        }
    }
}

export function main() {
    return async (params: ReadToolsParams): Promise<any> => {
        const tool_names = params?.tool_names || [];
        const skill_names = params?.skill_names || [];
        const toolCall = params.toolCall;
        
        // --- 1. 处理 Skill 筛选逻辑 ---
        const skillManager = toolCall.prompts.skillManager;
        let relevantSkills = skillManager.findRelevantSkills();
        
        // 如果传入了特定的 skill_names，则过滤出匹配的技能
        if (skill_names.length > 0) {
            relevantSkills = relevantSkills.filter(skill => skill_names.includes(skill.name));
        }
        
        const matchedSkills = relevantSkills.length > 0 
            ? skillManager.getSkillPrompt(relevantSkills) 
            : `No matching skills found for: ${skill_names.join(', ') || 'all'}.`;

        // --- 2. 处理 Tool 逻辑 ---
        const mcp_client = toolCall.mcp_client;
        await mcp_client.initMcp();
        const mcp_prompt = mcp_client.mcpPrompt;
        const mcp_tool_prompts = mcp_client.toolPrompts; 
        
        const prompt_file = toolCall.utils.getConfig("tool_call").cli_prompt || toolCall.utils.getDefault("prompts/cli_prompt.md");
        
        if (!existsSync(prompt_file)) {
            return {
                skills: matchedSkills,
                error: "The tool core description file does not exist"
            };
        }

        const fileContent = readFileSync(prompt_file, 'utf-8');

        // 如果没有传入特定的工具名，直接返回完整的工具内容 + 筛选后的 Skills
        if (tool_names.length === 0) {
            return {
                skills: matchedSkills,
                bash_tools: fileContent,
                mcp_tools: mcp_prompt
            };
        }

        // --- 逐行解析提取指定 Bash 工具逻辑 ---
        const lines = fileContent.split('\n');
        let extractedTools: string[] = [];
        let currentToolName: string | null = null;
        let currentToolLines: string[] = [];
        const toolStartRegex = /^- ([a-zA-Z0-9_-]+):/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const match = line.match(toolStartRegex);
            
            if (match && !line.startsWith('   - ') && !line.startsWith('    - ')) {
                if (currentToolName && tool_names.includes(currentToolName)) {
                    extractedTools.push(currentToolLines.join('\n').trim());
                }
                currentToolName = match[1];
                currentToolLines = [line];
            } else if (currentToolName) {
                currentToolLines.push(line);
                if (trimmedLine === '***') {
                    if (tool_names.includes(currentToolName)) {
                        extractedTools.push(currentToolLines.join('\n').trim());
                    }
                    currentToolName = null;
                    currentToolLines = [];
                }
            }
        }

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
                extractedMcpTools.push(mcp_tool_prompts[name]);
            }
        }

        const matchedMcpTools = extractedMcpTools.length > 0
            ? extractedMcpTools.join('\n\n---\n\n')
            : `No matching MCP tools found for: ${tool_names.join(', ')}.`;

        // 返回整合后的结果
        return {
            skills: matchedSkills,
            bash_tools: matchedBashTools,
            mcp_tools: matchedMcpTools
        };
    }
}