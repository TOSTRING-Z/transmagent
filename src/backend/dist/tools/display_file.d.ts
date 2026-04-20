import { ToolCall } from '../core/ToolCall';
export interface DisplayOptions {
    start_line?: string | number;
    line_count?: string | number;
    max_chars_per_line?: string | number;
    max_cols?: string | number;
}
export interface NormalizedOptions {
    startLine: number;
    lineCount: number;
    maxCharsPerLine: number;
    maxCols: number;
    fileType: string;
}
export interface ProcessResult {
    success: boolean;
    content: string;
    error?: string;
    metadata?: any;
}
export declare function main(params?: {
    local_path?: string;
}): (args: {
    file_path: string;
    toolCall: ToolCall;
} & DisplayOptions) => Promise<string>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            file_path: {
                type: string;
                description: string;
            };
            start_line: {
                type: string;
                default: number;
                description: string;
            };
            line_count: {
                type: string;
                default: number;
                description: string;
            };
            max_chars_per_line: {
                type: string;
                default: number;
                description: string;
            };
        };
        required: string[];
    };
};
