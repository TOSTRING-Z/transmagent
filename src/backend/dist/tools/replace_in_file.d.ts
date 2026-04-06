import { ToolCall } from '../core/ToolCall';
export interface ReplaceParams {
    file_path: string;
    diff: string;
    toolCall: ToolCall;
}
export declare function main(): ({ file_path, diff, toolCall }: ReplaceParams) => Promise<string>;
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
            diff: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
