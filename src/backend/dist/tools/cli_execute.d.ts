import { ToolCall } from '../core/ToolCall';
export interface CliExecuteParams {
    timeout?: number;
    delay_time?: number;
    max_lines?: number;
    max_chars_per_line?: number;
    bashrc?: string;
    show?: boolean;
    bash?: string;
    monitor_interval?: number;
    background?: boolean;
}
export interface ExecuteArgs {
    code: string;
    timeout?: number;
    toolCall: ToolCall;
    background?: boolean;
}
export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
    timeout?: boolean;
    message?: string;
    task_id?: string;
}
export declare function main(initialParams?: CliExecuteParams): ({ code, timeout, toolCall, background }: ExecuteArgs) => Promise<ExecuteResult>;
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
            timeout: {
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
