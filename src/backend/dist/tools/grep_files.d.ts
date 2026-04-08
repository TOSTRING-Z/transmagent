import { ToolCall } from '../core/ToolCall';
export interface GrepFilesParams {
    target_files: string[];
    regex: string;
    timeout_ms?: number;
    toolCall: ToolCall;
}
export interface SearchResult {
    file: string;
    match: string;
    context: string;
    line: number;
}
export declare function mainGrepFiles(): ({ target_files, regex, timeout_ms, toolCall }: GrepFilesParams) => Promise<SearchResult[] | string>;
export declare function getGrepFilesPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            target_files: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            regex: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
