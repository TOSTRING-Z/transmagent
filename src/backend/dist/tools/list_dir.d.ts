import { ToolCall } from '../core/ToolCall';
export interface ListFilesParams {
    threshold?: number;
    timeoutMs?: number;
}
export interface ListFilesArgs {
    path: string;
    recursive?: boolean;
    regex?: string | null;
    toolCall: ToolCall;
}
export declare function main(params?: ListFilesParams): (args: ListFilesArgs) => Promise<string[]>;
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
            recursive: {
                type: string;
                description: string;
                default: boolean;
            };
            regex: {
                type: string;
                description: string;
            };
        };
        required: string[];
        additionalProperties: boolean;
    };
};
