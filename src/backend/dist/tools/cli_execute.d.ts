export interface CliExecuteParams {
    timeout?: number;
    delay_time?: number;
    max_lines?: number;
    max_chars_per_line?: number;
    bashrc?: string;
    show?: boolean;
    bash?: string;
    monitor_interval?: number;
}
export interface ExecuteArgs {
    code: string;
    timeout?: number;
}
export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
    timeout?: boolean;
    message?: string;
}
export declare function main(initialParams?: CliExecuteParams): ({ code, timeout }: ExecuteArgs) => Promise<ExecuteResult>;
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
        };
        required: string[];
    };
};
