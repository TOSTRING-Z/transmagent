import * as fs from 'fs';
import * as path from 'path';
import { Skill } from '../types';

class SkillManager {
  skillsPath: string;
  skills: Skill[];
  constructor(skillsPath?: string | null) {
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
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
        if (match) {
          try {
            // 简单的正则解析 YAML 元数据，避免外部依赖
            const yamlText = match[1];
            const meta = {};
            yamlText.split('\n').forEach(line => {
              const [key, ...val] = line.split(':');
              if (key && val) meta[key.trim()] = val.join(':').trim();
            });
            return {
              name: meta['name'],
              description: meta['description'],
              allowedTools: meta['allowed-tools'] ? meta['allowed-tools'].split(',').map(t => t.trim()) : null,
              instructions: match[2].trim(),
              path: path.join(this.skillsPath, folder)
            };
          } catch (e: any) {
            console.error(`Failed to parse skill in ${folder}:`, e);
          }
        }
      }
      return null;
    }).filter(Boolean) as Skill[];
  }

  findRelevantSkills() {
    return this.skills;
  }

  getSkillPrompt(relevantSkills) {
    if (relevantSkills.length === 0) return '';

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

export { SkillManager };