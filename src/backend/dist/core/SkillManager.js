"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class SkillManager {
    skillsPath;
    skills;
    constructor(skillsPath) {
        this.skillsPath = skillsPath || path.join(__dirname, '../../skills');
        this.skills = [];
        this.loadSkills();
    }
    getSkillsPath() {
        return this.skillsPath;
    }
    loadSkills() {
        if (!fs.existsSync(this.skillsPath)) {
            fs.mkdirSync(this.skillsPath, { recursive: true });
            return;
        }
        const folders = fs.readdirSync(this.skillsPath);
        this.skills = folders.map(folder => {
            const skillMdPath = path.join(this.skillsPath, folder, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
                const content = fs.readFileSync(skillMdPath, 'utf-8');
                // 使用 \r?\n 来兼容两种换行符
                const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
                if (match) {
                    try {
                        // 简单的正则解析 YAML 元数据，避免外部依赖
                        const yamlText = match[1];
                        const meta = {};
                        yamlText.split('\n').forEach(line => {
                            const [key, ...val] = line.split(':');
                            if (key && val)
                                meta[key.trim()] = val.join(':').trim();
                        });
                        return {
                            name: meta['name'],
                            description: meta['description'],
                            allowedTools: meta['allowed-tools'] ? meta['allowed-tools'].split(',').map(t => t.trim()) : null,
                            instructions: match[2].trim(),
                            path: path.join(this.skillsPath, folder)
                        };
                    }
                    catch (e) {
                        console.error(`Failed to parse skill in ${folder}:`, e);
                    }
                }
            }
            return null;
        }).filter(Boolean);
    }
    findRelevantSkills() {
        return this.skills;
    }
    getSkillPrompt(relevantSkills) {
        if (relevantSkills.length === 0)
            return '';
        let prompt = '\n# 🌟 Active Agent Skills\n';
        relevantSkills.forEach(skill => {
            prompt += `\n## Skill: ${skill.name}\n`;
            if (skill.allowedTools && skill.allowedTools.length > 0) {
                prompt += `**⚠️ TOOL RESTRICTION**: For this skill, you are STRICTLY LIMITED to the following tools: ${skill.allowedTools.join(', ')}.\n`;
            }
            prompt += `${skill.instructions}\n`;
        });
        return prompt;
    }
}
exports.SkillManager = SkillManager;
//# sourceMappingURL=SkillManager.js.map