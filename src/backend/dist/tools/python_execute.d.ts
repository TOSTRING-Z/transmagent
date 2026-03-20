export interface PythonExecuteParams {
    python_bin: string;
    threshold?: number;
    show?: boolean;
    delay_time?: number;
}
export interface ExecuteArgs {
    code: string;
}
export interface ExecuteResult {
    success: boolean;
    output: string;
    error: string;
}
export declare function main(params: PythonExecuteParams): ({ code }: ExecuteArgs) => Promise<string>;
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
        };
        required: string[];
    };
};
