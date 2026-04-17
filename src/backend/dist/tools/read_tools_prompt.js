"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrompt = getPrompt;
exports.main = main;
const fs_1 = require("fs");
function getPrompt() {
    return {
        name: "read_tools_prompt",
        description: "Retrieve all available bash tools, MCP tools, and Agent Skills to build a complete workflow architecture.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional keyword to filter tools. If omitted, returns the full catalog."
                }
            },
            required: []
        }
    };
}
function main() {
    return async (params) => {
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
        if (!(0, fs_1.existsSync)(prompt_file)) {
            return {
                skills: matchedSkills,
                error: "The tool core description file (bash tools) does not exist at the configured path."
            };
        }
        const fileContent = (0, fs_1.readFileSync)(prompt_file, 'utf-8');
        // --- 4. 逻辑判断：如果 query 为空，直接返回全量内容 ---
        if (!query) {
            return {
                notice: "Returning full tool catalog for workflow planning.",
                skills: matchedSkills,
                bash_tools: fileContent,
                mcp_tools: mcp_full_prompt
            };
        }
        // --- 5. 如果确实需要检索 (模糊匹配逻辑) ---
        const keywords = query.split(/\s+/);
        const matches = (text) => keywords.some(k => text.toLowerCase().includes(k));
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
            skills: skillManager.getSkillContent(filteredSkills),
            bash_tools: filteredBash || "No matching bash tools found.",
            mcp_tools: filteredMcp || "No matching MCP tools found."
        };
    };
}
//# sourceMappingURL=read_tools_prompt.js.map