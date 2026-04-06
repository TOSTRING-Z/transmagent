import { ToolCall } from '../core/ToolCall';
export interface SearchFilesParams {
    path: string;
    regex?: string;
    file_pattern?: string;
    timeout_ms?: number;
    toolCall: ToolCall;
}
export interface SearchResult {
    file: string;
    match: string;
    context: string;
    line: number;
}
export declare function main(): ({ path: targetPath, regex, file_pattern, timeout_ms }: SearchFilesParams) => Promise<SearchResult[] | string>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            path: {
                type: string;
                description: string;
            };
            regex: {
                type: string;
                description: string;
            };
            file_pattern: {
                type: string;
                description: string;
            };
            timeout_ms: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
