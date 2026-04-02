/**
 * literature_search.ts
 * 全面最新文献查询工具
 * 支持多源学术数据库查询，自动提取论文元数据
 */
export interface LiteratureResult {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    publicationDate: string;
    journal: string;
    doi: string;
    url: string;
    citations: number;
    source: string;
    keywords: string[];
}
export interface LiteratureSearchParams {
    query: string;
    maxResults?: number;
    dateFrom?: string;
    dateTo?: string;
    source?: 'all' | 'pubmed' | 'arxiv' | 'semantic' | 'crossref';
    sortBy?: 'relevance' | 'date';
}
export interface LiteratureSearchResult {
    success: boolean;
    totalFound: number;
    results: LiteratureResult[];
    query: string;
    searchTime: string;
    sources: string[];
}
export declare const literatureSearchTool: {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            maxResults: {
                type: string;
                description: string;
                default: number;
            };
            dateFrom: {
                type: string;
                description: string;
            };
            dateTo: {
                type: string;
                description: string;
            };
            source: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            sortBy: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
        };
        required: string[];
    };
};
export declare function literatureSearch(params: LiteratureSearchParams): Promise<LiteratureSearchResult>;
export declare function searchLiterature(query: string, maxResults?: number): Promise<LiteratureSearchResult>;
export declare function main(params?: any): (args: LiteratureSearchParams) => Promise<LiteratureSearchResult>;
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
            maxResults: {
                type: string;
                description: string;
                default: number;
            };
            dateFrom: {
                type: string;
                description: string;
            };
            dateTo: {
                type: string;
                description: string;
            };
            source: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
            sortBy: {
                type: string;
                enum: string[];
                description: string;
                default: string;
            };
        };
        required: string[];
    };
};
