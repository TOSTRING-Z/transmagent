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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebCrawlerToolkit = exports.ContentFetcher = exports.BaiduSearch = exports.DuckDuckGoSearch = exports.BaseSearch = exports.TTLCache = void 0;
exports.main = main;
exports.getPrompt = getPrompt;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
const node_html_parser_1 = require("node-html-parser");
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const global_agent_1 = __importDefault(require("global-agent"));
// --- 初始化全局代理 (必须在所有HTTP请求之前) ---
function bootstrapGlobalProxy() {
    // 从环境变量获取代理地址
    const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY ||
        process.env.http_proxy || process.env.HTTP_PROXY ||
        process.env.ALL_PROXY || process.env.all_proxy;
    if (proxyUrl) {
        // 设置全局代理环境变量
        process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
        logger_1.logger.log(`Global proxy bootstrapped: ${proxyUrl}`);
    }
    // 初始化 global-agent (自动让所有 HTTP/HTTPS 请求使用代理)
    global_agent_1.default.bootstrap();
}
// 立即执行 bootstrap (模块加载时)
try {
    bootstrapGlobalProxy();
}
catch (e) {
    logger_1.logger.warn('Global proxy bootstrap failed, falling back to direct connection');
}
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
    timeout;
    cache;
    constructor(topk = 3, blackList = null, options = {}) {
        super(topk, blackList);
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
                logger_1.logger.warn(`DuckDuckGo Retry ${attempt + 1}/${maxRetry}: ${error.message}`);
                await this._sleep(Math.random() * 3000 + 2000);
            }
        }
        return { error: "All DuckDuckGo methods failed." };
    }
    async _callDDGS(query) {
        try {
            const htmlResults = await this._callDuckDuckGoHTML(query);
            if (htmlResults && htmlResults.length > 0)
                return htmlResults;
        }
        catch (error) {
            logger_1.logger.warn('DDG HTML failed:', error.message);
        }
        try {
            const apiResults = await this._callDuckDuckGoAPI(query);
            if (apiResults && apiResults.length > 0)
                return apiResults;
        }
        catch (error) {
            logger_1.logger.warn('DDG API failed:', error.message);
        }
        return null;
    }
    async _callDuckDuckGoAPI(query) {
        const endpoint = 'https://api.duckduckgo.com/';
        const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
        return new Promise((resolve, reject) => {
            const req = https.get(`${endpoint}?${params}`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(this._transformAPIResponse(JSON.parse(data)));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(this.timeout, () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }
    _transformAPIResponse(response) {
        const results = [];
        if (response.RelatedTopics) {
            response.RelatedTopics.forEach((topic) => {
                if (topic.FirstURL && topic.Text) {
                    results.push({ href: topic.FirstURL, title: topic.Text.split(' - ')[0], description: topic.Text });
                }
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
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
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.write(postData.toString());
            req.end();
        });
    }
    _parseHTMLResponse(html) {
        const root = (0, node_html_parser_1.parse)(html);
        const results = [];
        root.querySelectorAll('.result').forEach(element => {
            const titleElement = element.querySelector('.result__title a');
            const snippetElement = element.querySelector('.result__snippet');
            if (titleElement && snippetElement) {
                let href = titleElement.getAttribute('href') || '';
                try {
                    const url = new url_1.URL(href, 'https://html.duckduckgo.com');
                    href = url.searchParams.get('uddg') ? decodeURIComponent(url.searchParams.get('uddg')) : href;
                }
                catch { }
                results.push({ href, title: titleElement.textContent.trim(), description: snippetElement.textContent.trim() });
            }
        });
        return results.slice(0, 10);
    }
    _parseResponse(response) {
        const rawResults = response.map(item => [item.href, item.description || '', item.title || '']);
        return this._filterResults(rawResults);
    }
    _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}
exports.DuckDuckGoSearch = DuckDuckGoSearch;
// --- 百度搜索 ---
class BaiduSearch extends BaseSearch {
    cache;
    constructor(topk = 3, blackList = null, options = {}) {
        super(topk, blackList);
        this.cache = new TTLCache(100, 600);
    }
    async search(query, maxRetry = 2) {
        const cacheKey = `baidu_${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._scrapeBaidu(query);
                const result = this._parseResponse(response);
                this.cache.set(cacheKey, result);
                return result;
            }
            catch (error) {
                logger_1.logger.warn(`BaiduSearch Retry ${attempt + 1}/${maxRetry}: ${error.message}`);
                await new Promise(res => setTimeout(res, Math.random() * 2000 + 1000));
            }
        }
        throw new Error('Baidu Search failed after retries. Possibly blocked by anti-scraping.');
    }
    async _scrapeBaidu(query) {
        const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${this.topk + 10}`;
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Cookie': 'BAIDUID=8DFE41315570D0E79793132B401314B9:FG=1;'
                }
            };
            https.get(url, options, (res) => {
                let html = '';
                res.on('data', chunk => html += chunk);
                res.on('end', () => {
                    try {
                        const $ = cheerio.load(html);
                        const results = [];
                        $('#content_left > div.c-container').each((_, el) => {
                            const titleElement = $(el).find('h3.t a');
                            const title = titleElement.text().trim();
                            const href = titleElement.attr('href') || '';
                            let snippet = $(el).find('.c-abstract').first().text().trim();
                            if (!snippet)
                                snippet = $(el).find('div[class*="content-right_"]').text().trim();
                            if (!snippet)
                                snippet = $(el).find('.c-span18').text().trim();
                            if (title && href && href.startsWith('http')) {
                                results.push({ href, title, description: snippet });
                            }
                        });
                        resolve(results);
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
    }
    _parseResponse(response) {
        const rawResults = response.map(item => [item.href, item.description || '', item.title || '']);
        return this._filterResults(rawResults);
    }
}
exports.BaiduSearch = BaiduSearch;
// --- 统一内容获取器 ---
class ContentFetcher {
    cache;
    constructor() {
        this.cache = new TTLCache(100, 600);
    }
    async fetch(url, maxLength = 20000) {
        const cacheKey = `fetch_${url}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        return new Promise((resolve) => {
            const parsedUrl = new url_1.URL(url);
            const requestModule = parsedUrl.protocol === 'http:' ? http : https;
            requestModule.get(url, (res) => {
                let html = '';
                res.on('data', chunk => html += chunk);
                res.on('end', () => {
                    try {
                        const $ = cheerio.load(html);
                        $('script, style, noscript, iframe, nav, header, footer').remove();
                        const text = $('body').text().trim();
                        const cleanText = text.replace(/\s+/g, ' ').trim();
                        const truncatedText = cleanText.length > maxLength
                            ? cleanText.substring(0, maxLength) + '\n\n[Content truncated]'
                            : cleanText;
                        const result = [true, truncatedText];
                        this.cache.set(cacheKey, result);
                        resolve(result);
                    }
                    catch (error) {
                        const result = [false, error.message];
                        this.cache.set(cacheKey, result);
                        resolve(result);
                    }
                });
            }).on('error', (error) => {
                const result = [false, error.message];
                this.cache.set(cacheKey, result);
                resolve(result);
            });
        });
    }
}
exports.ContentFetcher = ContentFetcher;
// --- 核心工具类 (带降级机制) ---
class WebCrawlerToolkit {
    ddgSearcher;
    baiduSearcher;
    fetcher;
    searchResults = null;
    constructor(options = {}) {
        const { blackList = ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'], topk = 20, searcherOptions = {} } = options;
        // 实例化两个引擎
        this.ddgSearcher = new DuckDuckGoSearch(topk, blackList, searcherOptions);
        this.baiduSearcher = new BaiduSearch(topk, blackList, searcherOptions);
        this.fetcher = new ContentFetcher();
    }
    async search(query) {
        const queries = Array.isArray(query) ? query : [query];
        const searchResultsMap = {};
        for (const q of queries) {
            let result = null;
            try {
                // 默认优先使用 DuckDuckGo
                logger_1.logger.log(`Searching via DuckDuckGo: ${q}`);
                result = await this.ddgSearcher.search(q);
                // 处理 DDG 的自定义错误返回
                if (result && 'error' in result) {
                    logger_1.logger.warn(`DuckDuckGo failed: ${result.error}. Falling back to Baidu for query: ${q}`);
                    result = await this.baiduSearcher.search(q);
                }
            }
            catch (error) {
                // 捕获不可预见的异常并降级
                logger_1.logger.warn(`DuckDuckGo threw error: ${error.message}. Falling back to Baidu for query: ${q}`);
                try {
                    result = await this.baiduSearcher.search(q);
                }
                catch (baiduError) {
                    logger_1.logger.error(`Both search engines failed for query "${q}": ${baiduError.message}`);
                    continue; // 两个都失败则跳过该词条
                }
            }
            // 合并成功的结果
            if (result && !('error' in result)) {
                for (const item of Object.values(result)) {
                    if (!searchResultsMap[item.url]) {
                        searchResultsMap[item.url] = { ...item };
                    }
                    else {
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
    async select(selectIds, maxLength) {
        if (!this.searchResults)
            throw new Error('No search results to select from.');
        const newSearchResults = {};
        const fetchPromises = selectIds.map(id => Number(id)).filter(id => this.searchResults[id]).map(async (id) => {
            const [webSuccess, webContent] = await this.fetcher.fetch(this.searchResults[id].url, maxLength);
            if (webSuccess) {
                newSearchResults[id] = { ...this.searchResults[id], content: webContent };
                delete newSearchResults[id].summ;
            }
        });
        await Promise.allSettled(fetchPromises);
        return newSearchResults;
    }
    async readUrl(url, maxLength) {
        logger_1.logger.log(`Start Browsing: ${url}`);
        const [webSuccess, webContent] = await this.fetcher.fetch(url, maxLength);
        return webSuccess ? { type: 'text', content: webContent } : { error: webContent };
    }
    async checkStatus(url, timeoutMs = 5000) {
        return new Promise((resolve) => {
            try {
                const parsedUrl = new url_1.URL(url);
                // 根据协议自动选择 http 或 https 模块
                const requestModule = parsedUrl.protocol === 'http:' ? http : https;
                const options = {
                    method: 'HEAD',
                    timeout: timeoutMs
                };
                const req = requestModule.request(url, options, (res) => {
                    const isAccessible = res.statusCode ? (res.statusCode >= 200 && res.statusCode < 400) : false;
                    resolve({
                        accessible: isAccessible,
                        status: res.statusCode,
                        url
                    });
                });
                req.on('timeout', () => {
                    req.destroy();
                    resolve({ accessible: false, error: 'Timeout', status: 'timeout' });
                });
                req.on('error', (error) => {
                    resolve({ accessible: false, error: error.message, status: 'error' });
                });
                req.end();
            }
            catch (error) {
                resolve({ accessible: false, error: error.message, status: 'error' });
            }
        });
    }
}
exports.WebCrawlerToolkit = WebCrawlerToolkit;
// --- 模块级状态与入口函数 ---
let globalToolkitInstance = null;
let globalLastSearchResults = null;
function main(params = {}) {
    return async (args) => {
        try {
            if (!globalToolkitInstance) {
                globalToolkitInstance = new WebCrawlerToolkit({
                    topk: args.topk || 10,
                    searcherOptions: params.searcherOptions || {}
                });
                globalLastSearchResults = null;
            }
            const toolkit = globalToolkitInstance;
            const maxLength = args.max_length || 8192;
            let result;
            switch (args.action) {
                case 'search':
                    if (!args.query)
                        throw new Error('Query is required');
                    result = await toolkit.search(args.query);
                    globalLastSearchResults = result;
                    break;
                case 'select':
                    if (!args.select_ids)
                        throw new Error('select_ids is required');
                    if (!globalLastSearchResults)
                        throw new Error('Perform a search first.');
                    toolkit.searchResults = globalLastSearchResults;
                    result = await toolkit.select(args.select_ids, maxLength);
                    break;
                case 'read_url':
                    if (!args.url)
                        throw new Error('URL is required');
                    result = await toolkit.readUrl(args.url, maxLength);
                    break;
                case 'check_status':
                    if (!args.url)
                        throw new Error('URL is required');
                    result = await toolkit.checkStatus(args.url, args.timeout);
                    break;
                default:
                    throw new Error(`Unknown action: ${args.action}`);
            }
            logger_1.logger.log('web_crawler_toolkit result:', result);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`web_crawler_toolkit error: ${error.message}`);
            return { error: error.message };
        }
    };
}
function getPrompt() {
    return {
        "name": "web_crawler_toolkit",
        "description": `A robust suite for web exploration: handles multi-engine web searching (DuckDuckGo → Baidu fallback), batch result selection, deep content extraction, and URL status verification.

⚠️ IMPORTANT CAPABILITIES & LIMITATIONS:
- 'search' action: Performs WEB SEARCH via search engines. The 'url' parameter is IGNORED in search action.
  ✗ WRONG: search + url (to search within a website)
  ✓ CORRECT: search + query (to find relevant websites)
- 'read_url' action: Scrapes text content from a single target URL.
  ✓ Use this to fetch content from a specific page (e.g., GitHub repo, documentation)
- This tool does NOT support in-site searching. To find files within a repository:
  1. Use 'read_url' to fetch the page (e.g., GitHub file tree)
  2. Use 'select' to extract content from search results
  3. Process/analyze the content in your reasoning

WORKFLOW EXAMPLES:
① Find websites about a topic:
   {action: "search", query: ["Claude Code system prompt analysis"]}

② Get content from a specific URL:
   {action: "read_url", url: "https://github.com/user/repo", max_length: 15000}

③ Extract content from search results by ID:
   {action: "select", select_ids: [0, 1, 2], max_length: 8192}`,
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "(Required) Select from: 'search' | 'select' | 'read_url' | 'check_status'\n\n• 'search': Web search via DuckDuckGo/Baidu (uses 'query', ignores 'url')\n• 'select': Fetch content from previously found URLs by their result IDs\n• 'read_url': Scrape full text from a target URL\n• 'check_status': Verify if a URL is accessible"
                },
                "query": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "⚠️ Only for 'search' action. Web search keywords/phrases to query search engines. NOT for in-site search."
                },
                "select_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "⚠️ Only for 'select' action. IDs (0, 1, 2...) from previous search results to fetch content from."
                },
                "url": {
                    "type": "string",
                    "description": "⚠️ Only for 'read_url' or 'check_status' actions. Target URL to scrape or verify. Ignored in 'search' action."
                },
                "topk": {
                    "type": "number",
                    "description": "Number of web search results to return. Default: 10. Only for 'search' action."
                },
                "max_length": {
                    "type": "number",
                    "description": "Max characters of page content to return. Default: 8192. For 'select' and 'read_url'."
                },
                "timeout": {
                    "type": "number",
                    "description": "Timeout for requests in milliseconds. Default: 5000. For 'check_status'."
                }
            },
            "required": ["action"],
            "dependencies": {
                "search": ["query"],
                "select": ["select_ids"],
                "read_url": ["url"],
                "check_status": ["url"]
            }
        }
    };
}
//# sourceMappingURL=web_crawler_toolkit.js.map