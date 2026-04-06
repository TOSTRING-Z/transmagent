import { ToolCall } from '../core/ToolCall';
export interface SearchResultItem {
    url: string;
    summ?: string;
    title: string;
    content?: string;
}
export interface WebBrowserOptions {
    timeout?: number;
    blackList?: string[];
    topk?: number;
    searcherOptions?: any;
}
export interface ActionArgs {
    action: 'search' | 'select' | 'read_url' | 'check_status';
    query?: string | string[];
    select_ids?: number[] | string[];
    url?: string;
    topk?: number;
    timeout?: number;
    max_length?: number;
    toolCall: ToolCall;
}
export type RawSearchResult = [string, string, string];
export declare class TTLCache<T> {
    private maxsize;
    private ttl;
    private cache;
    constructor(maxsize?: number, ttl?: number);
    get(key: string): T | undefined;
    set(key: string, value: T): void;
}
export declare class BaseSearch {
    protected topk: number;
    protected blackList: string[];
    constructor(topk?: number, blackList?: string[] | null);
    protected _filterResults(results: RawSearchResult[]): Record<number, SearchResultItem>;
}
export declare class DuckDuckGoSearch extends BaseSearch {
    private timeout;
    private cache;
    constructor(topk?: number, blackList?: string[] | null, options?: any);
    search(query: string, maxRetry?: number): Promise<Record<number, SearchResultItem> | {
        error: string;
    }>;
    private _callDDGS;
    private _callDuckDuckGoAPI;
    private _transformAPIResponse;
    private _callDuckDuckGoHTML;
    private _parseHTMLResponse;
    private _parseResponse;
    private _sleep;
}
export declare class BaiduSearch extends BaseSearch {
    private cache;
    constructor(topk?: number, blackList?: string[] | null, options?: any);
    search(query: string, maxRetry?: number): Promise<Record<number, SearchResultItem>>;
    private _scrapeBaidu;
    private _parseResponse;
}
export declare class ContentFetcher {
    private cache;
    constructor();
    fetch(url: string, maxLength?: number): Promise<[boolean, string]>;
}
export declare class WebCrawlerToolkit {
    ddgSearcher: DuckDuckGoSearch;
    baiduSearcher: BaiduSearch;
    fetcher: ContentFetcher;
    searchResults: Record<number, SearchResultItem> | null;
    constructor(options?: WebBrowserOptions);
    search(query: string | string[]): Promise<Record<number, SearchResultItem>>;
    select(selectIds: number[] | string[], maxLength: number): Promise<Record<string | number, SearchResultItem>>;
    readUrl(url: string, maxLength: number): Promise<{
        type?: string;
        content?: string;
        error?: string;
    }>;
    checkStatus(url: string, timeout?: number): Promise<any>;
}
export declare function main(params?: any): (args: ActionArgs) => Promise<any>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            action: {
                type: string;
                description: string;
            };
            query: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            select_ids: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            url: {
                type: string;
                description: string;
            };
            topk: {
                type: string;
                description: string;
            };
            max_length: {
                type: string;
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
        required: string[];
        dependencies: {
            search: string[];
            select: string[];
            read_url: string[];
            check_status: string[];
        };
    };
};
