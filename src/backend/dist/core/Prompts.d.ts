import { SkillManager } from './SkillManager';
import { ToolCall } from './ToolCall';
import { Mode } from './ReActAgent';
export declare const MODE_CONSTRAINTS: Record<Mode, string>;
declare class Prompts {
    agent: ToolCall;
    skillManager: SkillManager;
    constructor(agent: ToolCall);
    getCliPrompt(): string;
    getExtraPrompt(extraPromptPath?: string | null): string;
    getSkillPrompt(): string;
    getSystemPrompts(toolsData: any): string;
    getTodoListPrompt(): "" | "\n### 📋 PROGRESS: {todolist}\n---";
    getEnvPrompts(): string;
}
export default Prompts;
