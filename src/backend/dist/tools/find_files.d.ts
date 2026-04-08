import { ToolCall } from '../core/ToolCall';
export interface FindFilesParams {
    dir_path: string;
    file_pattern: string;
    toolCall: ToolCall;
}
export declare function mainFindFiles(): ({ dir_path, file_pattern, toolCall }: FindFilesParams) => Promise<string[] | string>;
export declare function getFindFilesPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            dir_path: {
                type: string;
                description: string;
            };
            file_pattern: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
