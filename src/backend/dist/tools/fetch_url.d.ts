export interface FetchUrlArgs {
    url: string;
    text_max_len?: number;
}
export interface FetchUrlResult {
    url?: string;
    text?: string;
    error?: string;
}
export declare function main(): (params: FetchUrlArgs) => Promise<FetchUrlResult>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            url: {
                type: string;
                description: string;
            };
            text_max_len: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
