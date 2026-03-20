"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebBrowser = exports.ContentFetcher = exports.BingSearch = exports.DuckDuckGoSearch = exports.BaseSearch = exports.TTLCache = void 0;
exports.main = main;
exports.getPrompt = getPrompt;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
const node_html_parser_1 = require("node-html-parser");
const logger_1 = require("../utils/logger");
// --- 缓存实现 ---
class TTLCache {
    maxsize;
    ttl;
    cache;
    constructor(maxsize = 100, ttl = 600) {
        this.maxsize = maxsize;
        this.ttl = ttl;
        this.cache = new Map();
    }
    get(key) {
        const item = this.cache.get(key);
        if (!item)
            return undefined;
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return undefined;
        }
        return item.value;
    }
    set(key, value) {
        if (this.cache.size >= this.maxsize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey)
                this.cache.delete(firstKey);
        }
        this.cache.set(key, {
            value,
            expiry: Date.now() + (this.ttl * 1000)
        });
    }
}
exports.TTLCache = TTLCache;
// --- 基础搜索类 ---
class BaseSearch {
    topk;
    blackList;
    constructor(topk = 3, blackList = null) {
        this.topk = topk;
        this.blackList = blackList || ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'];
    }
    _filterResults(results) {
        const filteredResults = {};
        let count = 0;
        for (const [url, snippet, title] of results) {
            if (this.blackList.every(domain => !url.includes(domain)) && !url.endsWith('.pdf')) {
                filteredResults[count] = {
                    url,
                    summ: JSON.stringify(snippet).slice(1, -1),
                    title
                };
                count++;
                if (count >= this.topk)
                    break;
            }
        }
        return filteredResults;
    }
}
exports.BaseSearch = BaseSearch;
// --- DuckDuckGo搜索 ---
class DuckDuckGoSearch extends BaseSearch {
    proxy;
    timeout;
    cache;
    constructor(topk = 3, blackList = null, options = {}) {
        super(topk, blackList);
        this.proxy = options.proxy;
        this.timeout = options.timeout || 30000;
        this.cache = new TTLCache(100, 600);
    }
    async search(query, maxRetry = 1) {
        const cacheKey = `ddg_${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._callDDGS(query);
                if (!response)
                    throw new Error('No response from DDG');
                const result = this._parseResponse(response);
                this.cache.set(cacheKey, result);
                return result;
            }
            catch (error) {
                logger_1.logger.warn(`Retry ${attempt + 1}/${maxRetry} due to error: ${error.message}`);
                await this._sleep(Math.random() * 3000 + 2000);
            }
        }
        return {
            error: "All DuckDuckGo methods failed, please check whether the proxy tool is normal or whether DuckDuckGo is blocked."
        };
    }
    async _callDDGS(query) {
        try {
            const htmlResults = await this._callDuckDuckGoHTML(query);
            if (htmlResults && htmlResults.length > 0)
                return htmlResults;
        }
        catch (htmlError) {
            logger_1.logger.warn('DuckDuckGo HTML parsing failed:', htmlError.message);
        }
        try {
            const apiResults = await this._callDuckDuckGoAPI(query);
            if (apiResults && apiResults.length > 0)
                return apiResults;
        }
        catch (apiError) {
            logger_1.logger.warn('DuckDuckGo API failed:', apiError.message);
        }
        try {
            const npmResults = await this._callDDGSViaNPM(query);
            if (npmResults && npmResults.length > 0)
                return npmResults;
        }
        catch (npmError) {
            logger_1.logger.warn('DuckDuckGo NPM package failed:', npmError.message);
        }
        logger_1.logger.warn('All DuckDuckGo methods failed, returning null');
        return null;
    }
    async _callDuckDuckGoAPI(query) {
        const endpoint = 'https://api.duckduckgo.com/';
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            no_html: '1',
            no_redirect: '1',
            skip_disambig: '1',
            t: 'nodejs-web-browser'
        });
        return new Promise((resolve, reject) => {
            const req = https.get(`${endpoint}?${params}`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        resolve(this._transformAPIResponse(response));
                    }
                    catch (e) {
                        reject(new Error(`Failed to parse DuckDuckGo API response: ${e.message}`));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(this.timeout, () => {
                req.destroy();
                reject(new Error('DuckDuckGo API request timeout'));
            });
        });
    }
    _transformAPIResponse(response) {
        const results = [];
        if (response.Answer) {
            results.push({ href: response.AbstractURL || '', title: response.Heading || 'Instant Answer', description: response.Answer });
        }
        if (response.Abstract) {
            results.push({ href: response.AbstractURL || '', title: response.Heading || 'Abstract', description: response.Abstract });
        }
        if (response.RelatedTopics) {
            response.RelatedTopics.forEach((topic) => {
                if (topic.FirstURL && topic.Text) {
                    results.push({ href: topic.FirstURL, title: topic.Text.split(' - ')[0] || topic.Text, description: topic.Text });
                }
            });
        }
        if (response.Results) {
            response.Results.forEach((result) => {
                results.push({ href: result.FirstURL, title: result.Text.split(' - ')[0] || result.Text, description: result.Text });
            });
        }
        return results.slice(0, 10);
    }
    async _callDuckDuckGoHTML(query) {
        const endpoint = 'https://html.duckduckgo.com/html/';
        const postData = new URLSearchParams({ q: query, kl: 'us-en', df: 'y' });
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData.toString()),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        };
        return new Promise((resolve, reject) => {
            const req = https.request(endpoint, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(this._parseHTMLResponse(data));
                    }
                    catch (e) {
                        reject(new Error(`Failed to parse HTML: ${e.message}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(postData.toString());
            req.end();
            req.setTimeout(this.timeout, () => { req.destroy(); reject(new Error('HTML request timeout')); });
        });
    }
    _parseHTMLResponse(html) {
        const root = (0, node_html_parser_1.parse)(html);
        const results = [];
        const resultElements = root.querySelectorAll('.result');
        resultElements.forEach(element => {
            const titleElement = element.querySelector('.result__title a');
            const snippetElement = element.querySelector('.result__snippet');
            if (titleElement && snippetElement) {
                const href = titleElement.getAttribute('href');
                const actualUrl = this._extractActualUrl(href);
                const title = titleElement.textContent.trim();
                const description = snippetElement.textContent.trim();
                if (actualUrl && title && description) {
                    results.push({ href: actualUrl, title, description });
                }
            }
        });
        return results.slice(0, 10);
    }
    _extractActualUrl(ddgUrl) {
        if (!ddgUrl)
            return null;
        try {
            const url = new url_1.URL(ddgUrl, 'https://html.duckduckgo.com');
            const uddgParam = url.searchParams.get('uddg');
            return uddgParam ? decodeURIComponent(uddgParam) : ddgUrl;
        }
        catch {
            return ddgUrl;
        }
    }
    async _callDDGSViaNPM(query) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { DDGS } = require('duckduckgo-search-api');
            const ddgs = new DDGS();
            return await ddgs.text(query, { maxResults: 10 });
        }
        catch {
            logger_1.logger.warn('DuckDuckGo NPM package not available');
            return [];
        }
    }
    _parseResponse(response) {
        const rawResults = response.map(item => [
            item.href,
            item.description || item.body || '',
            item.title || ''
        ]);
        return this._filterResults(rawResults);
    }
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.DuckDuckGoSearch = DuckDuckGoSearch;
// --- Bing搜索 ---
class BingSearch extends BaseSearch {
    apiKey;
    market;
    proxy;
    cache;
    constructor(apiKey, region = 'zh-CN', topk = 3, blackList = null, options = {}) {
        super(topk, blackList);
        this.apiKey = apiKey;
        this.market = region;
        this.proxy = options.proxy;
        this.cache = new TTLCache(100, 600);
    }
    async search(query, maxRetry = 1) {
        const cacheKey = `bing_${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._callBingAPI(query);
                const result = this._parseResponse(response);
                this.cache.set(cacheKey, result);
                return result;
            }
            catch (error) {
                logger_1.logger.warn(`Retry ${attempt + 1}/${maxRetry} due to error: ${error.message}`);
                await new Promise(res => setTimeout(res, Math.random() * 3000 + 2000));
            }
        }
        throw new Error('Failed to get search results from Bing Search after retries.');
    }
    async _callBingAPI(query) {
        const endpoint = 'https://api.bing.microsoft.com/v7.0/search';
        const params = new URLSearchParams({ q: query, mkt: this.market, count: (this.topk * 2).toString() });
        const options = { headers: { 'Ocp-Apim-Subscription-Key': this.apiKey } };
        return new Promise((resolve, reject) => {
            const req = https.get(`${endpoint}?${params}`, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
        });
    }
    _parseResponse(response) {
        const webpages = {};
        for (const w of response.webPages?.value || [])
            webpages[w.id] = w;
        const rawResults = [];
        const mainline = response.rankingResponse?.mainline?.items || [];
        for (const item of mainline) {
            if (item.answerType === 'WebPages' && webpages[item.value.id]) {
                const w = webpages[item.value.id];
                rawResults.push([w.url, w.snippet, w.name]);
            }
            else if (item.answerType === 'News' && item.value.id === response.news?.id) {
                for (const news of response.news?.value || []) {
                    rawResults.push([news.url, news.description, news.name]);
                }
            }
        }
        return this._filterResults(rawResults);
    }
}
exports.BingSearch = BingSearch;
// --- 内容获取器 ---
class ContentFetcher {
    timeout;
    cache;
    constructor(timeout = 5000) {
        this.timeout = timeout;
        this.cache = new TTLCache(100, 600);
    }
    async fetch(url) {
        const cacheKey = `fetch_${url}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        try {
            const response = await this._makeRequest(url);
            const text = this._cleanText(response);
            const result = [true, text];
            this.cache.set(cacheKey, result);
            return result;
        }
        catch (error) {
            const result = [false, error.message];
            this.cache.set(cacheKey, result);
            return result;
        }
    }
    async _makeRequest(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, (res) => {
                if (res.statusCode !== 200)
                    return reject(new Error(`HTTP ${res.statusCode}`));
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.setTimeout(this.timeout, () => { req.destroy(); reject(new Error('Request timeout')); });
        });
    }
    _cleanText(html) {
        const root = (0, node_html_parser_1.parse)(html);
        root.querySelectorAll('script, style, noscript, iframe, nav, header, footer').forEach(el => el.remove());
        return (root.textContent || '').replace(/\n+/g, '\n').replace(/\s+/g, ' ').trim();
    }
}
exports.ContentFetcher = ContentFetcher;
// --- 网页浏览器工具 ---
class WebBrowser {
    searcher;
    fetcher;
    searchResults = null;
    constructor(options = {}) {
        const { searcherType = 'DuckDuckGoSearch', timeout = 5000, blackList = ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'], topk = 20, searcherOptions = {} } = options;
        this.searcher = this._createSearcher(searcherType, blackList, topk, searcherOptions);
        this.fetcher = new ContentFetcher(timeout);
    }
    _createSearcher(type, blackList, topk, options) {
        if (type === 'BingSearch')
            return new BingSearch(options.apiKey, options.region, topk, blackList, options);
        return new DuckDuckGoSearch(topk, blackList, options);
    }
    async search(query) {
        const queries = Array.isArray(query) ? query : [query];
        const searchResultsMap = {};
        const searchPromises = queries.map(q => this.searcher.search(q));
        const results = await Promise.allSettled(searchPromises);
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && !('error' in result.value)) {
                for (const resultItem of Object.values(result.value)) {
                    if (!searchResultsMap[resultItem.url]) {
                        searchResultsMap[resultItem.url] = { ...resultItem };
                    }
                    else {
                        searchResultsMap[resultItem.url].summ += `\n${resultItem.summ}`;
                    }
                }
            }
            else if (result.status === 'rejected') {
                logger_1.logger.warn(`Query "${queries[i]}" generated an exception: ${result.reason}`);
            }
        }
        this.searchResults = {};
        let idx = 0;
        for (const result of Object.values(searchResultsMap)) {
            this.searchResults[idx++] = result;
        }
        return this.searchResults;
    }
    async select(selectIds) {
        if (!this.searchResults)
            throw new Error('No search results to select from.');
        const newSearchResults = {};
        const fetchPromises = selectIds
            .map(id => Number(id))
            .filter(id => this.searchResults[id])
            .map(async (id) => {
            try {
                const [webSuccess, webContent] = await this.fetcher.fetch(this.searchResults[id].url);
                if (webSuccess) {
                    newSearchResults[id] = { ...this.searchResults[id], content: webContent.substring(0, 8192) };
                    delete newSearchResults[id].summ;
                }
            }
            catch (error) {
                logger_1.logger.warn(`ID ${id} generated an exception: ${error.message}`);
            }
        });
        await Promise.allSettled(fetchPromises);
        return newSearchResults;
    }
    async openUrl(url) {
        logger_1.logger.log(`Start Browsing: ${url}`);
        const [webSuccess, webContent] = await this.fetcher.fetch(url);
        if (webSuccess) {
            let limitedContent = webContent;
            if (webContent.length > 20000) {
                logger_1.logger.log(`Content truncated from ${webContent.length} to 20000 characters`);
                limitedContent = webContent.substring(0, 20000) + '\n\n[Content truncated due to length limit]';
            }
            return { type: 'text', content: limitedContent };
        }
        return { error: webContent };
    }
    async checkUrlAccessibility(url, timeout = 5000) {
        try {
            logger_1.logger.log(`Checking URL accessibility: ${url}`);
            try {
                new url_1.URL(url); // 基本格式验证
            }
            catch {
                return { accessible: false, error: `Invalid URL format: ${url}`, status: 'invalid' };
            }
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            clearTimeout(timeoutId);
            return {
                accessible: response.ok,
                status: response.status,
                statusText: response.statusText,
                contentType: response.headers.get('content-type'),
                url: response.url
            };
        }
        catch (error) {
            let errorType = 'any';
            if (error.name === 'AbortError')
                errorType = 'timeout';
            else if (error.message.includes('fetch'))
                errorType = 'network_error';
            return { accessible: false, error: error.message, errorType, status: 'error' };
        }
    }
}
exports.WebBrowser = WebBrowser;
// --- 模块级状态管理（替代原代码中挂载在函数上的乱象） ---
let globalBrowserInstance = null;
let globalLastSearchResults = null;
function main(params = { searcher_type: "DuckDuckGoSearch", api_key: null, region: "zh-CN" }) {
    return async (args) => {
        try {
            if (!globalBrowserInstance) {
                globalBrowserInstance = new WebBrowser({
                    searcherType: params.searcher_type,
                    topk: args.topk || 10,
                    timeout: args.timeout || 5000,
                    searcherOptions: { apiKey: params.api_key, region: params.region || 'zh-CN' }
                });
                globalLastSearchResults = null;
            }
            const browser = globalBrowserInstance;
            let result;
            switch (args.action) {
                case 'search':
                    if (!args.query)
                        throw new Error('Query parameter is required for search action');
                    result = await browser.search(args.query);
                    globalLastSearchResults = result;
                    break;
                case 'select':
                    if (!args.select_ids || !Array.isArray(args.select_ids))
                        throw new Error('select_ids parameter (array) is required');
                    if (!globalLastSearchResults)
                        throw new Error('No search results to select from. Please perform a search first.');
                    browser.searchResults = globalLastSearchResults;
                    result = await browser.select(args.select_ids);
                    break;
                case 'open_url':
                    if (!args.url)
                        throw new Error('URL parameter is required for open_url action');
                    result = await browser.openUrl(args.url);
                    break;
                case 'check_accessibility':
                    if (!args.url)
                        throw new Error('URL parameter is required for check_accessibility action');
                    result = await browser.checkUrlAccessibility(args.url);
                    break;
                default:
                    throw new Error(`Unknown action: ${args.action}`);
            }
            logger_1.logger.log('fetch_search result:', result);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`fetch_search error: ${error.message}`);
            return { error: error.message };
        }
    };
}
function getPrompt() {
    return {
        "name": "fetch_search",
        "description": "A comprehensive web browsing tool that can search the web, select specific results, open URLs to fetch content, and check URL accessibility.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": { "type": "string", "description": "(Required) 'search', 'select', 'open_url', 'check_accessibility'" },
                "query": { "type": "array", "items": { "type": "string" } },
                "select_ids": { "type": "array", "items": { "type": "string" } },
                "url": { "type": "string" },
                "topk": { "type": "number", "description": "Default: 10" },
                "timeout": { "type": "number", "description": "Default: 5000" }
            },
            "required": ["action", "query", "select_ids", "url"]
        }
    };
}
//# sourceMappingURL=fetch_search.js.map