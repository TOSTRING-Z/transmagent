import { SkillManager } from './SkillManager';
import { ToolCall } from './ToolCall';
declare class Prompts {
    agent: ToolCall;
    skillManager: SkillManager;
    constructor(agent: ToolCall);
    getCliPrompt(): string;
    getExtraPrompt(extra_prompt?: string | null): string;
    getSkillPrompt(): string;
    getSystemPrompts(toolsData: any): string;
    getEnvPrompts(): string;
}
export default Prompts;
