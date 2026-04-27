import { ToolCall } from './ToolCall';
import { Mode } from './LLMBase';
export declare const MODE_CONSTRAINTS: Record<Mode, string>;
declare class Prompts {
    toolCall: ToolCall;
    constructor(toolCall: ToolCall);
    getCliPrompt(): string;
    getExtraPrompt(extraPromptPath?: string | null): string;
    getSystemPrompts(toolsData: any): string;
    getTodoListPrompt(): "" | "\n### 📋 PROGRESS: {todolist}\n";
    getEnvPrompts(): string;
}
export default Prompts;
