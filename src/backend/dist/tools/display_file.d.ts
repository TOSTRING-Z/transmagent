import { ToolCall } from '../core/ToolCall';
export interface DisplayOptions {
    start_line?: string | number;
    end_line?: string | number;
    max_line_length?: string | number;
    max_cols?: string | number;
    format?: string;
}
export interface NormalizedOptions {
    startLine: number;
    endLine: number;
    maxLineLength: number;
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
            };
            end_line: {
                type: string;
                description: string;
            };
            format: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            max_line_length: {
                type: string;
                default: number;
            };
            max_cols: {
                type: string;
                default: number;
            };
        };
        required: string[];
    };
};
