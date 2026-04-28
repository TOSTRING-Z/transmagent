import { ToolCall } from '../core/ToolCall';
export interface PythonExecuteParams {
    python_bin: string;
    threshold?: number;
    show?: boolean;
    delay_time?: number;
    background?: boolean;
}
export interface ExecuteArgs {
    code: string;
    toolCall: ToolCall;
    background?: boolean;
}
export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
    task_id?: string;
}
export declare function main(params: PythonExecuteParams): ({ code, toolCall, background }: ExecuteArgs) => Promise<string>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            code: {
                type: string;
                description: string;
            };
            background: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
