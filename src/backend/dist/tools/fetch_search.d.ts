export interface SearchResultItem {
    url: string;
    summ?: string;
    title: string;
    content?: string;
}
export interface WebBrowserOptions {
    searcherType?: string;
    timeout?: number;
    blackList?: string[];
    topk?: number;
    searcherOptions?: any;
}
export interface ActionArgs {
    action: 'search' | 'select' | 'open_url' | 'check_accessibility';
    query?: string | string[];
    select_ids?: number[] | string[];
    url?: string;
    topk?: number;
    timeout?: number;
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
    private proxy?;
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
    private _extractActualUrl;
    private _callDDGSViaNPM;
    private _parseResponse;
    private _sleep;
}
export declare class BingSearch extends BaseSearch {
    private apiKey;
    private market;
    private proxy?;
    private cache;
    constructor(apiKey: string, region?: string, topk?: number, blackList?: string[] | null, options?: any);
    search(query: string, maxRetry?: number): Promise<Record<number, SearchResultItem>>;
    private _callBingAPI;
    private _parseResponse;
}
export declare class ContentFetcher {
    private timeout;
    private cache;
    constructor(timeout?: number);
    fetch(url: string): Promise<[boolean, string]>;
    private _makeRequest;
    private _cleanText;
}
export declare class WebBrowser {
    searcher: DuckDuckGoSearch | BingSearch;
    fetcher: ContentFetcher;
    searchResults: Record<number, SearchResultItem> | null;
    constructor(options?: WebBrowserOptions);
    private _createSearcher;
    search(query: string | string[]): Promise<Record<number, SearchResultItem>>;
    select(selectIds: number[] | string[]): Promise<Record<string | number, SearchResultItem>>;
    openUrl(url: string): Promise<{
        type?: string;
        content?: string;
        error?: string;
    }>;
    checkUrlAccessibility(url: string, timeout?: number): Promise<any>;
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
            };
            select_ids: {
                type: string;
                items: {
                    type: string;
                };
            };
            url: {
                type: string;
            };
            topk: {
                type: string;
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
