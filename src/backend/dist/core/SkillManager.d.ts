declare class SkillManager {
    skillsPath: string;
    skills: any[];
    constructor(skillsPath?: string | null);
    getSkillsPath(): string;
    loadSkills(): void;
    findRelevantSkills(): any[];
    getSkillPrompt(relevantSkills: any): string;
}
export { SkillManager };
