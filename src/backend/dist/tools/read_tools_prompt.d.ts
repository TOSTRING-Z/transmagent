export interface ReadToolsParams {
    tool_names?: string[];
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
        };
        required: never[];
    };
};
export declare function main(): (params?: ReadToolsParams) => Promise<any>;
