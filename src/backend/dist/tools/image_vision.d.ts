import { ToolCall } from '../core/ToolCall';
export interface VisionParams {
    api_url?: string;
    api_key: string;
    model?: string;
}
export interface ToolArgs {
    prompt: string;
    file_path: string;
    toolCall: ToolCall;
}
export declare function main(params: VisionParams): (args: ToolArgs) => Promise<string>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            prompt: {
                type: string;
                description: string;
            };
            file_path: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
