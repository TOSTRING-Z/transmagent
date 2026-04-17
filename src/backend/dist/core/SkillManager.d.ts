import { ConnectConfig } from 'ssh2';
import { Skill } from '../types';
export interface SshConfig extends ConnectConfig {
    enabled?: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
}
declare class SkillManager {
    skillsPath: string;
    skills: Skill[];
    sshConfig?: SshConfig;
    constructor(skillsPath?: string | null, sshConfig?: SshConfig);
    getSkillsPath(): string;
    private parseSkillContent;
    loadSkills(): Promise<void>;
    private loadLocalSkills;
    private loadRemoteSkills;
    findRelevantSkills(): Skill[];
    getSkillContent(relevantSkills: Skill[], instructions?: boolean): string;
    getSkillPrompt(): string;
    getSkillDescription(): string;
}
export { SkillManager };
