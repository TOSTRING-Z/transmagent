import { Skill } from '../types';
declare class SkillManager {
    skillsPath: string;
    skills: Skill[];
    constructor(skillsPath?: string | null);
    getSkillsPath(): string;
    loadSkills(): void;
    findRelevantSkills(): Skill[];
    getSkillPrompt(relevantSkills: any): string;
}
export { SkillManager };
