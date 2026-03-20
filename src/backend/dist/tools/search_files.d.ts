export interface SearchFilesParams {
    path: string;
    regex?: string;
    file_pattern?: string;
}
export interface SearchResult {
    file: string;
    match: string;
    context: string;
    line: number;
}
export declare function main(): ({ path: targetPath, regex, file_pattern }: SearchFilesParams) => Promise<SearchResult[] | string>;
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
            regex: {
                type: string;
                description: string;
            };
            file_pattern: {
                type: string;
                description: string;
            };
            file: {
                type: string;
                description: string;
            };
            match: {
                type: string;
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            line: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
