import { ToolCall } from "../core/ToolCall";
export interface ReadToolsParams {
    query?: string;
    toolCall: ToolCall;
}
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
        };
        required: never[];
    };
};
export declare function main(): (params: ReadToolsParams) => Promise<any>;
