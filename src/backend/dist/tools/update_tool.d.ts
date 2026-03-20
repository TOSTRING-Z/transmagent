export interface UpdateToolParams {
    tool_name: string;
    tool_documentation: string;
}
export interface UpdateToolResult {
    success: boolean;
    action?: 'updated' | 'added';
    tool?: string;
    message?: string;
    error?: string;
}
export declare function main(): (params: UpdateToolParams) => Promise<UpdateToolResult>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            tool_name: {
                type: string;
                description: string;
            };
            tool_documentation: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
