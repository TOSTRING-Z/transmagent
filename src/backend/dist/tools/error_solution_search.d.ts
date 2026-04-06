import { ToolCall } from '../core/ToolCall';
export interface ErrorSolutionParams {
    error_message: string;
    max_results?: number;
    toolCall: ToolCall;
}
export interface SolutionMetadata {
    rank: number;
    votes: number;
    answers: number;
    views: number;
    is_answered: boolean;
}
export interface FormattedSolution {
    site: string;
    title: string;
    url: string;
    type: string;
    source_type: string;
    metadata: SolutionMetadata;
}
export interface SearchResult {
    success: boolean;
    error?: string;
    error_type?: string[];
    search_strategy?: string;
    sources_searched?: string[];
    solutions_count?: number;
    solutions: FormattedSolution[];
}
export interface RawSolution {
    title: string;
    url: string;
    votes: number;
    answers: number;
    views: number;
    is_answered: boolean;
}
export declare function main(): ({ error_message, max_results, toolCall }: ErrorSolutionParams) => Promise<SearchResult>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            error_message: {
                type: string;
                description: string;
            };
            max_results: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
