import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { parse as htmlParse } from 'node-html-parser';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';

// --- 类型定义 ---
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
}

export type RawSearchResult = [string, string, string]; // [url, snippet, title]

// --- 缓存实现 ---
export class TTLCache<T> {
    private maxsize: number;
    private ttl: number;
    private cache: Map<string, { value: T; expiry: number }>;

    constructor(maxsize = 100, ttl = 600) {
        this.maxsize = maxsize;
        this.ttl = ttl;
        this.cache = new Map();
    }

    get(key: string): T | undefined {
        const item = this.cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return undefined;
        }
        return item.value;
    }

    set(key: string, value: T): void {
        if (this.cache.size >= this.maxsize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expiry: Date.now() + (this.ttl * 1000)
        });
    }
}

// --- 基础搜索类 ---
export class BaseSearch {
    protected topk: number;
    protected blackList: string[];

    constructor(topk = 3, blackList: string[] | null = null) {
        this.topk = topk;
        this.blackList = blackList || ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'];
    }

    protected _filterResults(results: RawSearchResult[]): Record<number, SearchResultItem> {
        const filteredResults: Record<number, SearchResultItem> = {};
        let count = 0;

        for (const [url, snippet, title] of results) {
            if (this.blackList.every(domain => !url.includes(domain)) && !url.endsWith('.pdf')) {
                filteredResults[count] = {
                    url,
                    summ: JSON.stringify(snippet).slice(1, -1),
                    title
                };
                count++;
                if (count >= this.topk) break;
            }
        }
        return filteredResults;
    }
}

// --- DuckDuckGo搜索 ---
export class DuckDuckGoSearch extends BaseSearch {
    private timeout: number;
    private cache: TTLCache<Record<number, SearchResultItem>>;

    constructor(topk = 3, blackList: string[] | null = null, options: any = {}) {
        super(topk, blackList);
        this.timeout = options.timeout || 30000;
        this.cache = new TTLCache(100, 600);
    }

    async search(query: string, maxRetry = 1): Promise<Record<number, SearchResultItem> | { error: string }> {
        const cacheKey = `ddg_${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._callDDGS(query);
                if (!response) throw new Error('No response from DDG');
                const result = this._parseResponse(response);
                this.cache.set(cacheKey, result);
                return result;
            } catch (error: any) {
                logger.warn(`DuckDuckGo Retry ${attempt + 1}/${maxRetry}: ${error.message}`);
                await this._sleep(Math.random() * 3000 + 2000);
            }
        }
        return { error: "All DuckDuckGo methods failed." };
    }

    private async _callDDGS(query: string): Promise<any> {
        try {
            const htmlResults = await this._callDuckDuckGoHTML(query);
            if (htmlResults && htmlResults.length > 0) return htmlResults;
        } catch (error: any) { logger.warn('DDG HTML failed:', error.message); }

        try {
            const apiResults = await this._callDuckDuckGoAPI(query);
            if (apiResults && apiResults.length > 0) return apiResults;
        } catch (error: any) { logger.warn('DDG API failed:', error.message); }

        return null;
    }

    private async _callDuckDuckGoAPI(query: string): Promise<any[]> {
        const endpoint = 'https://api.duckduckgo.com/';
        const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });

        return new Promise((resolve, reject) => {
            const req = https.get(`${endpoint}?${params}`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(this._transformAPIResponse(JSON.parse(data))); } 
                    catch (e: any) { reject(e); }
                });
            });
            req.on('error', reject);
            req.setTimeout(this.timeout, () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }

    private _transformAPIResponse(response: any): any[] {
        const results: any[] = [];
        if (response.RelatedTopics) {
            response.RelatedTopics.forEach((topic: any) => {
                if (topic.FirstURL && topic.Text) {
                    results.push({ href: topic.FirstURL, title: topic.Text.split(' - ')[0], description: topic.Text });
                }
            });
        }
        return results.slice(0, 10);
    }

    private async _callDuckDuckGoHTML(query: string): Promise<any[]> {
        const endpoint = 'https://html.duckduckgo.com/html/';
        const postData = new URLSearchParams({ q: query, kl: 'us-en', df: 'y' });
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData.toString()),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(endpoint, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(this._parseHTMLResponse(data)); } catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(postData.toString());
            req.end();
        });
    }

    private _parseHTMLResponse(html: string): any[] {
        const root = htmlParse(html);
        const results: any[] = [];
        root.querySelectorAll('.result').forEach(element => {
            const titleElement = element.querySelector('.result__title a');
            const snippetElement = element.querySelector('.result__snippet');
            if (titleElement && snippetElement) {
                let href = titleElement.getAttribute('href') || '';
                try {
                    const url = new URL(href, 'https://html.duckduckgo.com');
                    href = url.searchParams.get('uddg') ? decodeURIComponent(url.searchParams.get('uddg')!) : href;
                } catch {}
                results.push({ href, title: titleElement.textContent.trim(), description: snippetElement.textContent.trim() });
            }
        });
        return results.slice(0, 10);
    }

    private _parseResponse(response: any[]): Record<number, SearchResultItem> {
        const rawResults: RawSearchResult[] = response.map(item => [item.href, item.description || '', item.title || '']);
        return this._filterResults(rawResults);
    }

    private _sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

// --- 百度搜索 ---
export class BaiduSearch extends BaseSearch {
    private cache: TTLCache<Record<number, SearchResultItem>>;

    constructor(topk = 3, blackList: string[] | null = null, options: any = {}) {
        super(topk, blackList);
        this.cache = new TTLCache(100, 600);
    }

    async search(query: string, maxRetry = 2): Promise<Record<number, SearchResultItem>> {
        const cacheKey = `baidu_${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._scrapeBaidu(query);
                const result = this._parseResponse(response);
                this.cache.set(cacheKey, result);
                return result;
            } catch (error: any) {
                logger.warn(`BaiduSearch Retry ${attempt + 1}/${maxRetry}: ${error.message}`);
                await new Promise(res => setTimeout(res, Math.random() * 2000 + 1000));
            }
        }
        throw new Error('Baidu Search failed after retries. Possibly blocked by anti-scraping.');
    }

    private async _scrapeBaidu(query: string): Promise<any[]> {
        const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${this.topk + 10}`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Cookie': 'BAIDUID=8DFE41315570D0E79793132B401314B9:FG=1;'
            }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);
        const results: any[] = [];

        $('#content_left > div.c-container').each((_, el) => {
            const titleElement = $(el).find('h3.t a');
            const title = titleElement.text().trim();
            const href = titleElement.attr('href') || '';
            
            let snippet = $(el).find('.c-abstract').first().text().trim();
            if (!snippet) snippet = $(el).find('div[class*="content-right_"]').text().trim();
            if (!snippet) snippet = $(el).find('.c-span18').text().trim();

            if (title && href && href.startsWith('http')) {
                results.push({ href, title, description: snippet });
            }
        });

        return results;
    }

    private _parseResponse(response: any[]): Record<number, SearchResultItem> {
        const rawResults: RawSearchResult[] = response.map(item => [item.href, item.description || '', item.title || '']);
        return this._filterResults(rawResults);
    }
}

// --- 统一内容获取器 ---
export class ContentFetcher {
    private cache: TTLCache<[boolean, string]>;

    constructor() {
        this.cache = new TTLCache(100, 600);
    }

    async fetch(url: string, maxLength: number = 20000): Promise<[boolean, string]> {
        const cacheKey = `fetch_${url}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'zh-CN,zh;q=0.9'
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const html = await response.text();
            const $ = cheerio.load(html);
            
            $('script, style, noscript, iframe, nav, header, footer').remove();
            
            const text = $('body').text().trim();
            const cleanText = text.replace(/\s+/g, ' ').trim();
            
            const truncatedText = cleanText.length > maxLength 
                ? cleanText.substring(0, maxLength) + '\n\n[Content truncated]' 
                : cleanText;

            const result: [boolean, string] = [true, truncatedText];
            this.cache.set(cacheKey, result);
            return result;
        } catch (error: any) {
            const result: [boolean, string] = [false, error.message];
            this.cache.set(cacheKey, result);
            return result;
        }
    }
}

// --- 核心工具类 (带降级机制) ---
export class WebCrawlerToolkit {
    public ddgSearcher: DuckDuckGoSearch;
    public baiduSearcher: BaiduSearch;
    public fetcher: ContentFetcher;
    public searchResults: Record<number, SearchResultItem> | null = null;

    constructor(options: WebBrowserOptions = {}) {
        const { blackList = ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'], topk = 20, searcherOptions = {} } = options;
        
        // 实例化两个引擎
        this.ddgSearcher = new DuckDuckGoSearch(topk, blackList, searcherOptions);
        this.baiduSearcher = new BaiduSearch(topk, blackList, searcherOptions);
        this.fetcher = new ContentFetcher();
    }

    async search(query: string | string[]): Promise<Record<number, SearchResultItem>> {
        const queries = Array.isArray(query) ? query : [query];
        const searchResultsMap: Record<string, SearchResultItem> = {};

        for (const q of queries) {
            let result: any = null;
            try {
                // 默认优先使用 DuckDuckGo
                logger.log(`Searching via DuckDuckGo: ${q}`);
                result = await this.ddgSearcher.search(q);
                
                // 处理 DDG 的自定义错误返回
                if (result && 'error' in result) {
                    logger.warn(`DuckDuckGo failed: ${result.error}. Falling back to Baidu for query: ${q}`);
                    result = await this.baiduSearcher.search(q);
                }
            } catch (error: any) {
                // 捕获不可预见的异常并降级
                logger.warn(`DuckDuckGo threw error: ${error.message}. Falling back to Baidu for query: ${q}`);
                try {
                    result = await this.baiduSearcher.search(q);
                } catch (baiduError: any) {
                    logger.error(`Both search engines failed for query "${q}": ${baiduError.message}`);
                    continue; // 两个都失败则跳过该词条
                }
            }

            // 合并成功的结果
            if (result && !('error' in result)) {
                for (const item of Object.values(result as Record<number, SearchResultItem>)) {
                    if (!searchResultsMap[item.url]) {
                        searchResultsMap[item.url] = { ...item };
                    } else {
                        searchResultsMap[item.url].summ += `\n${item.summ}`;
                    }
                }
            }
        }

        // 重新构建索引
        this.searchResults = {};
        let idx = 0;
        for (const result of Object.values(searchResultsMap)) {
            this.searchResults[idx++] = result;
        }
        return this.searchResults;
    }

    async select(selectIds: number[] | string[], maxLength: number): Promise<Record<string | number, SearchResultItem>> {
        if (!this.searchResults) throw new Error('No search results to select from.');
        const newSearchResults: Record<string | number, SearchResultItem> = {};
        
        const fetchPromises = selectIds.map(id => Number(id)).filter(id => this.searchResults![id]).map(async (id) => {
            const [webSuccess, webContent] = await this.fetcher.fetch(this.searchResults![id].url, maxLength);
            if (webSuccess) {
                newSearchResults[id] = { ...this.searchResults![id], content: webContent };
                delete newSearchResults[id].summ;
            }
        });

        await Promise.allSettled(fetchPromises);
        return newSearchResults;
    }

    async readUrl(url: string, maxLength: number): Promise<{ type?: string; content?: string; error?: string }> {
        logger.log(`Start Browsing: ${url}`);
        const [webSuccess, webContent] = await this.fetcher.fetch(url, maxLength);
        return webSuccess ? { type: 'text', content: webContent } : { error: webContent };
    }

    async checkStatus(url: string, timeout = 5000): Promise<any> {
        try {
            new URL(url);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeoutId);
            return { accessible: response.ok, status: response.status, url: response.url };
        } catch (error: any) {
            return { accessible: false, error: error.message, status: 'error' };
        }
    }
}

// --- 模块级状态与入口函数 ---
let globalToolkitInstance: WebCrawlerToolkit | null = null;
let globalLastSearchResults: Record<number, SearchResultItem> | null = null;

// 参数中不再需要 searcher_type
export function main(params: any = {}) {
    return async (args: ActionArgs) => {
        try {
            if (!globalToolkitInstance) {
                globalToolkitInstance = new WebCrawlerToolkit({
                    topk: args.topk || 10,
                    // 如果未来还需要配置全局超时或代理，可以从 params 中提取传递给 searcherOptions
                    searcherOptions: params.searcherOptions || {} 
                });
                globalLastSearchResults = null;
            }

            const toolkit = globalToolkitInstance;
            const maxLength = args.max_length || 8192;
            let result;

            switch (args.action) {
                case 'search':
                    if (!args.query) throw new Error('Query is required');
                    result = await toolkit.search(args.query);
                    globalLastSearchResults = result as Record<number, SearchResultItem>;
                    break;
                case 'select':
                    if (!args.select_ids) throw new Error('select_ids is required');
                    if (!globalLastSearchResults) throw new Error('Perform a search first.');
                    toolkit.searchResults = globalLastSearchResults;
                    result = await toolkit.select(args.select_ids, maxLength);
                    break;
                case 'read_url':
                    if (!args.url) throw new Error('URL is required');
                    result = await toolkit.readUrl(args.url, maxLength);
                    break;
                case 'check_status':
                    if (!args.url) throw new Error('URL is required');
                    result = await toolkit.checkStatus(args.url, args.timeout);
                    break;
                default:
                    throw new Error(`Unknown action: ${args.action}`);
            }
            logger.log('web_crawler_toolkit result:', result);
            return result;
        } catch (error: any) {
            logger.error(`web_crawler_toolkit error: ${error.message}`);
            return { error: error.message };
        }
    };
}

export function getPrompt() {
    return {
        "name": "web_crawler_toolkit",
        "description": "A robust suite for web exploration: handles multi-engine searching (defaults to DuckDuckGo, falls back to Baidu), batch result selection, deep content extraction (HTML-to-Text), and URL status verification.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": { 
                    "type": "string", 
                    "description": "(Required) Select from: 'search' (web search), 'select' (fetch multiple search results by ID), 'read_url' (scrape full page text), 'check_status' (validate URL accessibility)" 
                },
                "query": { "type": "array", "items": { "type": "string" }, "description": "Search queries for 'search' action" },
                "select_ids": { "type": "array", "items": { "type": "string" }, "description": "IDs from search results to extract content" },
                "url": { "type": "string", "description": "Target URL for 'read_url' or 'check_status'" },
                "topk": { "type": "number", "description": "Results count. Default: 10" },
                "max_length": { "type": "number", "description": "Max characters of page content to return. Default: 8192" },
                "timeout": { "type": "number", "description": "Timeout for requests in milliseconds. Default: 5000" }
            },
            "required": ["action"]
        }
    };
}