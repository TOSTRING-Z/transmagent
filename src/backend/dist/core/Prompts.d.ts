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
    /**
     * 生成后台任务完成结果的分隔提示文本，统一追加到消息末尾。
     * @param taskId 后台任务 ID
     * @param content 任务输出内容
     * @returns 带分隔符的结果提示字符串
     */
    getTaskResultPrompt(taskId: string, content: string): string;
}
export default Prompts;
