import { ToolCall } from "../core/ToolCall";
export interface ReadToolsParams {
    tool_names?: string[];
    skill_names?: string[];
    toolCall: ToolCall;
}
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            tool_names: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            skill_names: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: never[];
    };
};
export declare function main(): (params: ReadToolsParams) => Promise<any>;
