import { ToolCall } from "../core/ToolCall";

// --- 类型定义 ---
export interface ReadSkillInstructionsParams {
    query?: string;     // 可选关键词过滤技能
    toolCall: ToolCall;
}

export function getPrompt() {
    return {
        name: "read_skill_instructions",
        description: "Read the full instructions (SKILL.md contents) of all active Agent Skills. Use this when you need to understand detailed skill capabilities, usage procedures, and behavioral constraints before invoking a skill. Supports optional keyword filtering by skill name or description.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Optional keyword(s) to filter skills by name or description. Supports space-separated multi-keyword matching. If omitted, returns instructions for ALL active skills."
                }
            },
            required: []
        }
    }
}

export function main() {
    return async (params: ReadSkillInstructionsParams): Promise<any> => {
        const query = (params?.query || "").toLowerCase().trim();
        const toolCall = params.toolCall;

        // --- 获取所有 Skill ---
        const skillManager = toolCall.skillManager;
        const allSkills = skillManager.findRelevantSkills();

        // --- 无激活技能 ---
        if (allSkills.length === 0) {
            return {
                skills: "",
                notice: "No active skills detected."
            };
        }

        // --- 无 query：返回全部技能的完整 instructions ---
        if (!query) {
            return {
                notice: "Returning full instructions for all active skills.",
                skills: skillManager.getSkillContent(allSkills, true)
            };
        }

        // --- 有关键词：模糊匹配过滤 ---
        const keywords = query.split(/\s+/);
        const matches = (text: string) => keywords.some(k => text.toLowerCase().includes(k));

        const filteredSkills = allSkills.filter(
            s => matches(s.name) || (s.description && matches(s.description))
        );

        if (filteredSkills.length === 0) {
            return {
                skills: "",
                search_query: query,
                notice: `No skills matching "${query}" were found.`
            };
        }

        return {
            search_query: query,
            skills: skillManager.getSkillContent(filteredSkills, true)
        };
    }
}
