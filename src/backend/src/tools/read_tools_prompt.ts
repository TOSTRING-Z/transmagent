import { existsSync, readFileSync } from "fs";
import { ToolCall } from "../core/ToolCall";

// --- 类型定义 ---
export interface ReadToolsParams {
    query?: string; // 保留参数接口，但逻辑默认导向全量读取
    toolCall: ToolCall;
}

export function getPrompt() {
    return {
        name: "read_tools_prompt",
        // 🚀 核心优化：显式定义【双态机制】（Planning Mode vs Non-Planning Mode）
        description: "CRITICAL (DUAL-MODE SPECIFICATION):\n" +
                     "1. PLANNING MODE: If your current goal is to design, architect, or map out a workflow, you MUST call this tool to inspect available analytical and data assets. Under this mode, this tool is strictly for UNDERSTANDING. It DOES NOT grant execution privileges; you cannot execute the tools discovered herein directly.\n" +
                     "2. NON-PLANNING MODE (EXECUTION ACTIVE): If you have already finalized the workflow blueprint and are now in the active task execution phase, this tool functions as an authoritative runtime catalog. In this mode, YOU HAVE FULL EXECUTION PRIVILEGES to invoke and drive the discovered bash tools, MCP tools, and skills to operate on data and systems.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional keyword to filter tools. Leave blank during planning to scan the full system capabilities, or specify keywords during execution to pinpoint specific operational tools."
                }
            },
            required: []
        }
    }
}

export function main() {
    return async (params: ReadToolsParams): Promise<any> => {
        const query = (params?.query || "").toLowerCase().trim();
        const toolCall = params.toolCall;
        
        // --- 1. 获取所有 Skill ---
        const skillManager = toolCall.skillManager;
        const allSkills = skillManager.findRelevantSkills();
        let matchedSkills = skillManager.getSkillContent(allSkills);

        // --- 2. 获取所有 MCP 工具 ---
        const mcp_client = toolCall.mcp_client;
        await mcp_client.initMcp();
        const mcp_tool_prompts = mcp_client.toolPrompts;
        const mcp_full_prompt = mcp_client.mcpPrompt;
        
        // --- 3. 获取 Bash 工具 (cli_prompt.md) ---
        const prompt_file = toolCall.utils.getConfig("tool_call").cli_prompt || toolCall.utils.getDefault("prompts/cli_prompt.md");
        
        if (!existsSync(prompt_file)) {
            return {
                skills: matchedSkills,
                error: "The tool core description file (bash tools) does not exist at the configured path."
            };
        }
        const fileContent = readFileSync(prompt_file, 'utf-8');

        // --- 4. 逻辑判断：如果 query 为空，直接返回全量内容 ---
        if (!query) {
            return {
                // 🚀 返回中同步强化双态逻辑的提醒
                notice: "SYSTEM CAPABILITY RESPONDED. Dual-mode notice: " +
                        "[Planning Mode] Use this data solely for blueprinting; no immediate execution allowed within this view. " +
                        "[Non-Planning Mode] Full execution privileges granted. You may proceed to actively route tasks to the specific runtimes described below.",
                skills: matchedSkills,
                bash_tools: fileContent,
                mcp_tools: mcp_full_prompt
            };
        }

        // --- 5. 如果确实需要检索 (模糊匹配逻辑) ---
        const keywords = query.split(/\s+/);
        const matches = (text: string) => keywords.some(k => text.toLowerCase().includes(k));

        // 过滤 Skills
        const filteredSkills = allSkills.filter(s => matches(s.name) || (s.description && matches(s.description)));
        
        // 过滤 MCP
        const filteredMcp = Object.keys(mcp_tool_prompts)
            .filter(name => matches(name) || matches(mcp_tool_prompts[name]))
            .map(name => mcp_tool_prompts[name])
            .join('\n\n---\n\n');

        // 过滤 Bash (简单块提取)
        const bashBlocks = fileContent.split('***');
        const filteredBash = bashBlocks
            .filter(block => matches(block))
            .join('\n***\n');

        return {
            search_query: query,
            notice: "FILTERED CAPABILITY RESPONDED. If in Execution Mode, ensure the targeted operational tool is accurately fully matched.",
            skills: skillManager.getSkillContent(filteredSkills),
            bash_tools: filteredBash || "No matching bash tools found.",
            mcp_tools: filteredMcp || "No matching MCP tools found."
        };
    }
}