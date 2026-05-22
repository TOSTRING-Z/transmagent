import path from "path";
import { ToolCall } from "../core/ToolCall";

// --- 类型定义 ---
export interface ReadSkillInstructionsParams {
    skill_name: string; // 变更：变为必填的具体技能名称
    toolCall: ToolCall;
}

export function getPrompt() {
    return {
        name: "read_skill_instructions",
        description: "Read the detailed instructions and behavioral constraints of a SPECIFIC agent skill by its name. Bulk loading or listing all skills at once is STRICTLY FORBIDDEN for performance and isolation stability. You must specify the exact skill name you wish to inspect.",
        parameters: {
            type: "object",
            properties: {
                skill_name: {
                    type: "string",
                    description: "The exact name or folder name of the skill you want to read (e.g., 'data-sync', 'bio-orchestrator')."
                }
            },
            required: ["skill_name"] // 🌟 核心变更：设定为必填项
        }
    }
}

export function main() {
    return async (params: ReadSkillInstructionsParams): Promise<any> => {
        const targetSkillName = (params?.skill_name || "").trim();
        const toolCall = params.toolCall;
        const skillManager = toolCall.skillManager;

        // --- 防御性校验：如果模型绕过 schema 传了空值 ---
        if (!targetSkillName) {
            return {
                skills: "",
                status: "error",
                notice: "Access denied. Parameter 'skill_name' is mandatory. You are not allowed to read all skills globally.",
                guide: (skillManager as any).getSkillCreationGuide?.() || ""
            };
        }

        const isRemote = !!(skillManager.sshConfig?.enabled && skillManager.sshConfig?.host);

        // 🔴 SSH 模式: 热加载动态扫盘确保数据最新
        if (isRemote) {
            try {
                await skillManager.loadRemoteSkillsAsync();
            } catch (err: any) {
                return {
                    skills: "",
                    status: "error",
                    notice: `SSH skill load failed: ${err.message}`,
                    guide: (skillManager as any).getSkillCreationGuide?.() || ""
                };
            }
        }

        const allSkills = skillManager.findRelevantSkills();

        // --- 无激活技能 ---
        if (allSkills.length === 0) {
            return {
                skills: "",
                status: "empty",
                notice: `No active skills found in the workspace. Target skill '${targetSkillName}' does not exist.`,
                guide: (skillManager as any).getSkillCreationGuide?.() || ""
            };
        }

        // --- 单一技能精确/文件夹名匹配 ---
        const targetLower = targetSkillName.toLowerCase();
        const matchedSkill = allSkills.find(s => {
            // 同时匹配配置中的 name 字段或其所在的物理文件夹名
            const folderName = path.basename(s.path).toLowerCase();
            return s.name.toLowerCase() === targetLower || folderName === targetLower;
        });

        // --- 未匹配到指定技能 ---
        if (!matchedSkill) {
            return {
                skills: "",
                status: "not_found",
                notice: `Requested skill '${targetSkillName}' was not found or failed to load. Ensure the name matches exactly.`,
                guide: (skillManager as any).getSkillCreationGuide?.() || ""
            };
        }

        // --- 成功返回：仅吐出这一根单独 Skill 的指令内容 ---
        return {
            skill_name: matchedSkill.name,
            status: "success",
            skills: skillManager.getSkillContent([matchedSkill], true)
        };
    }
}