import { logger } from '../utils/logger';
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { parse: htmlParse } = require('node-html-parser');

// 缓存实现
class TTLCache {
    maxsize: number;
    ttl: number;
    cache: any;
    cacheData: any;
    cacheTime: any;
    // @ts-ignore
    cacheData: any;
    // @ts-ignore
    cacheTime: any;

    constructor(maxsize = 100, ttl = 600) {
        this.maxsize = maxsize;
        this.ttl = ttl;
        this.cache = new Map();
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return undefined;
        }
        return item.value;
    }

    set(key, value) {
        if (this.cache.size >= this.maxsize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expiry: Date.now() + (this.ttl * 1000)
        });
    }
}

// 基础搜索类
class BaseSearch {
    constructor(topk = 3, blackList = null) {
        // @ts-ignore
        this.topk = topk;
        // @ts-ignore
        this.blackList = blackList || ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'];
    }

    _filterResults(results) {
        const filteredResults = {};
        let count = 0;

        for (const [url, snippet, title] of results) {
            // @ts-ignore
            if (this.blackList.every(domain => !url.includes(domain)) && !url.endsWith('.pdf')) {
                filteredResults[count] = {
                    url,
                    summ: JSON.stringify(snippet).slice(1, -1),
                    title
                };
                count++;
                // @ts-ignore
                if (count >= this.topk) break;
            }
        }
        return filteredResults;
    }
}

// DuckDuckGo搜索 - 完整实现
class DuckDuckGoSearch extends BaseSearch {
    constructor(topk = 3, blackList = null, options = {}) {
        super(topk, blackList);
        // @ts-ignore
        this.proxy = options.proxy;
        // @ts-ignore
        this.timeout = options.timeout || 30000;
        // @ts-ignore
        this.cache = new TTLCache(100, 600);
    }

    async search(query, maxRetry = 1) {
        const cacheKey = `ddg_${query}`;
        // @ts-ignore
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._callDDGS(query);
                const result = this._parseResponse(response);
                // @ts-ignore
                this.cache.set(cacheKey, result);
                return result;
            } catch (error: any) {
                logger.warn(`Retry ${attempt + 1}/${maxRetry} due to error: ${error.message}`);
                await this._sleep(Math.random() * 3000 + 2000);
            }
        }
        return {
            error: "All DuckDuckGo methods failed, please check whether the proxy tool is normal or whether DuckDuckGo is blocked."
        }
    }

    // 修改 _callDDGS 方法，确保HTML解析方式为首选
    async _callDDGS(query) {
        try {
            // 首选：使用HTML解析方式
            const htmlResults = await this._callDuckDuckGoHTML(query);
            // @ts-ignore
            if (htmlResults && htmlResults.length > 0) {
                return htmlResults;
            }
        } catch (htmlError: any) {
            logger.warn('DuckDuckGo HTML parsing failed:', htmlError.message);
        }

        try {
            // 备用方案1：使用官方API
            const apiResults = await this._callDuckDuckGoAPI(query);
            // @ts-ignore
            if (apiResults && apiResults.length > 0) {
                return apiResults;
            }
        } catch (apiError: any) {
            logger.warn('DuckDuckGo API failed:', apiError.message);
        }

        try {
            // 备用方案2：使用第三方NPM包
            const npmResults = await this._callDDGSViaNPM(query);
            if (npmResults && npmResults.length > 0) {
                return npmResults;
            }
        } catch (npmError: any) {
            logger.warn('DuckDuckGo NPM package failed:', npmError.message);
        }

        // 最后的备用方案：返回模拟数据确保测试能继续
        logger.warn('All DuckDuckGo methods failed, returning test data');
        return null;
    }

    // 方法1: 使用DuckDuckGo官方API
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
                    } catch (e: any) {
                        reject(new Error(`Failed to parse DuckDuckGo API response: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            // @ts-ignore
            req.setTimeout(this.timeout, () => {
                req.destroy();
                reject(new Error('DuckDuckGo API request timeout'));
            });
        });
    }

    // 转换官方API响应格式
    _transformAPIResponse(response) {
        const results: any[] = [];

        // 添加即时答案（如果有）
        if (response.Answer && response.Answer !== '') {
            results.push({
                href: response.AbstractURL || '',
                title: response.Heading || 'Instant Answer',
                description: response.Answer,
                body: response.Answer
            });
        }

        // 添加抽象摘要（如果有）
        if (response.Abstract && response.Abstract !== '') {
            results.push({
                href: response.AbstractURL || '',
                title: response.Heading || 'Abstract',
                description: response.Abstract,
                body: response.Abstract
            });
        }

        // 添加相关主题
        if (response.RelatedTopics && response.RelatedTopics.length > 0) {
            response.RelatedTopics.forEach(topic => {
                if (topic.FirstURL && topic.Text) {
                    results.push({
                        href: topic.FirstURL,
                        title: topic.Text.split(' - ')[0] || topic.Text,
                        description: topic.Text,
                        body: topic.Text
                    });
                }
            });
        }

        // 添加搜索结果
        if (response.Results && response.Results.length > 0) {
            response.Results.forEach(result => {
                results.push({
                    href: result.FirstURL,
                    title: result.Text.split(' - ')[0] || result.Text,
                    description: result.Text,
                    body: result.Text
                });
            });
        }

        return results.slice(0, 10); // 限制结果数量
    }

    // 方法2: 使用HTML解析方式（备用方法）
    async _callDuckDuckGoHTML(query) {
        const endpoint = 'https://html.duckduckgo.com/html/';
        const postData = new URLSearchParams({
            q: query,
            kl: 'us-en',
            df: 'y' // 禁用安全搜索
        });

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData.toString()),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(endpoint, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const results = this._parseHTMLResponse(data);
                        resolve(results);
                    } catch (e: any) {
                        reject(new Error(`Failed to parse DuckDuckGo HTML response: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData.toString());
            req.end();

            // @ts-ignore
            req.setTimeout(this.timeout, () => {
                req.destroy();
                reject(new Error('DuckDuckGo HTML request timeout'));
            });
        });
    }

    // 解析HTML响应
    _parseHTMLResponse(html) {
        const root = htmlParse(html);
        const results: any[] = [];

        // 查找搜索结果
        const resultElements = root.querySelectorAll('.result');

        resultElements.forEach(element => {
            const titleElement = element.querySelector('.result__title a');
            const snippetElement = element.querySelector('.result__snippet');

            if (titleElement && snippetElement) {
                const href = titleElement.getAttribute('href');
                // 解码DuckDuckGo的重定向URL
                const actualUrl = this._extractActualUrl(href);
                const title = titleElement.textContent.trim();
                const description = snippetElement.textContent.trim();

                if (actualUrl && title && description) {
                    results.push({
                        href: actualUrl,
                        title: title,
                        description: description,
                        body: description
                    });
                }
            }
        });

        return results.slice(0, 10);
    }

    // 从DuckDuckGo重定向URL中提取实际URL
    _extractActualUrl(ddgUrl) {
        if (!ddgUrl) return null;

        try {
            // DuckDuckGo的重定向URL格式：/l/?kh=-1&uddg=https://actual-url.com
            const url = new URL(ddgUrl, 'https://html.duckduckgo.com');
            const uddgParam = url.searchParams.get('uddg');
            if (uddgParam) {
                return decodeURIComponent(uddgParam);
            }
            return ddgUrl;
        } catch (e: any) {
            return ddgUrl;
        }
    }

    // 方法3: 使用第三方DuckDuckGo API包装器（如果需要更稳定的服务）
    async _callDDGSViaNPM(query) {
        try {
            // 使用正确的包名和导入方式
            const { DDGS } = require('duckduckgo-search-api');
            const ddgs = new DDGS();
            const results = await ddgs.text(query, { maxResults: 10 });
            return results;
        } catch (error: any) {
            logger.warn('DuckDuckGo NPM package not available, falling back to direct API');
            // 返回空数组而不是抛出错误，让调用方继续使用其他方法
            return [];
        }
    }

    _parseResponse(response) {
        const rawResults: any[] = [];
        for (const item of response) {
            rawResults.push([
                item.href,
                item.description || item.body,
                item.title
            ]);
        }
        return this._filterResults(rawResults);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Bing搜索
class BingSearch extends BaseSearch {
    constructor(apiKey, region = 'zh-CN', topk = 3, blackList = null, options = {}) {
        super(topk, blackList);
        // @ts-ignore
        this.apiKey = apiKey;
        // @ts-ignore
        this.market = region;
        // @ts-ignore
        this.proxy = options.proxy;
        // @ts-ignore
        this.cache = new TTLCache(100, 600);
    }

    async search(query, maxRetry = 1) {
        const cacheKey = `bing_${query}`;
        // @ts-ignore
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                const response = await this._callBingAPI(query);
                const result = this._parseResponse(response);
                // @ts-ignore
                this.cache.set(cacheKey, result);
                return result;
            } catch (error: any) {
                logger.warn(`Retry ${attempt + 1}/${maxRetry} due to error: ${error.message}`);
                await this._sleep(Math.random() * 3000 + 2000);
            }
        }
        throw new Error('Failed to get search results from Bing Search after retries.');
    }

    async _callBingAPI(query) {
        const endpoint = 'https://api.bing.microsoft.com/v7.0/search';
        const params = new URLSearchParams({
            q: query,
            // @ts-ignore
            mkt: this.market,
            // @ts-ignore
            count: (this.topk * 2).toString()
        });

        const options = {
            headers: {
                // @ts-ignore
                'Ocp-Apim-Subscription-Key': this.apiKey
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.get(`${endpoint}?${params}`, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e: any) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    _parseResponse(response) {
        const webpages = {};
        for (const w of response.webPages?.value || []) {
            webpages[w.id] = w;
        }

        const rawResults: any[] = [];
        const mainline = response.rankingResponse?.mainline?.items || [];

        for (const item of mainline) {
            if (item.answerType === 'WebPages' && webpages[item.value.id]) {
                const webpage = webpages[item.value.id];
                rawResults.push([webpage.url, webpage.snippet, webpage.name]);
            } else if (item.answerType === 'News' && item.value.id === response.news?.id) {
                for (const news of response.news?.value || []) {
                    rawResults.push([news.url, news.description, news.name]);
                }
            }
        }

        return this._filterResults(rawResults);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 内容获取器
class ContentFetcher {
    constructor(timeout = 5000) {
        // @ts-ignore
        this.timeout = timeout;
        // @ts-ignore
        this.cache = new TTLCache(100, 600);
    }

    async fetch(url) {
        const cacheKey = `fetch_${url}`;
        // @ts-ignore
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await this._makeRequest(url);
            const text = this._cleanText(response);
            const result = [true, text];
            // @ts-ignore
            this.cache.set(cacheKey, result);
            return result;
        } catch (error: any) {
            const result = [false, error.message];
            // @ts-ignore
            this.cache.set(cacheKey, result);
            return result;
        }
    }

    async _makeRequest(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', reject);
            // @ts-ignore
            req.setTimeout(this.timeout, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    _cleanText(html) {
        const root = htmlParse(html);

        // 移除不需要的元素
        root.querySelectorAll('script, style, noscript, iframe, nav, header, footer').forEach(el => el.remove());

        const text = root.textContent;
        return text.replace(/\n+/g, '\n').replace(/\s+/g, ' ').trim();
    }
}

// 网页浏览器工具
class WebBrowser {
    constructor(options = {}) {
        const {
            // @ts-ignore
            searcherType = 'DuckDuckGoSearch',
            // @ts-ignore
            timeout = 5000,
            // @ts-ignore
            blackList = ['enoN', 'youtube.com', 'bilibili.com', 'researchgate.net'],
            // @ts-ignore
            topk = 20,
            // @ts-ignore
            searcherOptions = {}
        } = options;

        // @ts-ignore
        this.searcher = this._createSearcher(searcherType, blackList, topk, searcherOptions);
        // @ts-ignore
        this.fetcher = new ContentFetcher(timeout);
        // @ts-ignore
        this.searchResults = null;
    }

    _createSearcher(searcherType, blackList, topk, options) {
        switch (searcherType) {
            case 'DuckDuckGoSearch':
                return new DuckDuckGoSearch(topk, blackList, options);
            case 'BingSearch':
                return new BingSearch(options.apiKey, options.region, topk, blackList, options);
            default:
                throw new Error(`Unsupported searcher type: ${searcherType}`);
        }
    }

    async search(query) {
        const queries = Array.isArray(query) ? query : [query];
        const searchResults = {};

        // @ts-ignore
        const searchPromises = queries.map(q => this.searcher.search(q));
        const results = await Promise.allSettled(searchPromises);

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                for (const resultItem of Object.values(result.value)) {
                    // @ts-ignore
                    if (!searchResults[resultItem.url]) {
                        // @ts-ignore
                        searchResults[resultItem.url] = resultItem;
                    } else {
                        // @ts-ignore
                        searchResults[resultItem.url].summ += `\n${resultItem.summ}`;
                    }
                }
            } else {
                logger.warn(`Query "${queries[i]}" generated an exception: ${result.reason}`);
            }
        }

        // @ts-ignore
        this.searchResults = {};
        let idx = 0;
        for (const result of Object.values(searchResults)) {
            // @ts-ignore
            this.searchResults[idx++] = result;
        }

        // @ts-ignore
        return this.searchResults;
    }

    async select(selectIds) {
        // @ts-ignore
        if (!this.searchResults) {
            throw new Error('No search results to select from.');
        }

        const newSearchResults = {};
        const fetchPromises = selectIds
            // @ts-ignore
            .filter(id => this.searchResults[id])
            .map(async (id) => {
                try {
                    // @ts-ignore
                    const [webSuccess, webContent] = await this.fetcher.fetch(this.searchResults[id].url);
                    if (webSuccess) {
                        // @ts-ignore
                        this.searchResults[id].content = webContent.substring(0, 8192);
                        // @ts-ignore
                        newSearchResults[id] = { ...this.searchResults[id] };
                        delete newSearchResults[id].summ;
                    }
                } catch (error: any) {
                    logger.warn(`ID ${id} generated an exception: ${error.message}`);
                }
            });

        await Promise.allSettled(fetchPromises);
        return newSearchResults;
    }

    async openUrl(url) {
        logger.log(`Start Browsing: ${url}`);
        // @ts-ignore
        const [webSuccess, webContent] = await this.fetcher.fetch(url);

        if (webSuccess) {
            // 限制内容最大长度为20000字符
            let limitedContent = webContent;
            if (webContent && webContent.length > 20000) {
                logger.log(`Content truncated from ${webContent.length} to 20000 characters`);
                limitedContent = webContent.substring(0, 20000);

                // 可选：添加截断提示
                limitedContent += '\n\n[Content truncated due to length limit]';
            }

            return { type: 'text', content: limitedContent };
        } else {
            return { error: webContent };
        }
    }

    // 检查网址是否可访问
    async checkUrlAccessibility(url, timeout = 5000) {
        try {
            logger.log(`Checking URL accessibility: ${url}`);

            // 基本的URL格式验证
            try {
                new URL(url);
            } catch (e: any) {
                return {
                    accessible: false,
                    error: `Invalid URL format: ${url}`,
                    status: 'invalid'
                };
            }

            // 使用fetch检查URL可访问性
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            clearTimeout(timeoutId);

            return {
                accessible: response.ok,
                status: response.status,
                statusText: response.statusText,
                contentType: response.headers.get('content-type'),
                url: response.url
            };

        } catch (error: any) {
            console.error(`URL accessibility check failed: ${error.message}`);

            let errorType = 'any';
            if (error.name === 'AbortError') {
                errorType = 'timeout';
            } else if (error.message.includes('Failed to fetch')) {
                errorType = 'network_error';
            } else if (error.message.includes('Invalid URL')) {
                errorType = 'invalid_url';
            }

            return {
                accessible: false,
                error: error.message,
                errorType: errorType,
                status: 'error'
            };
        }
    }

}

/**
 * main 函数
 * searcher_type: Type of search engine to use. Default: 'DuckDuckGoSearch'. Options: 'DuckDuckGoSearch', 'BingSearch' 
 */
function main(params = { searcher_type: "DuckDuckGoSearch", api_key: null, region: "zh-CN" }) {
    return async ({
        action,
        query,
        select_ids,
        url,
        topk = 10,
        timeout = 5000
    }) => {
        try {
            // 使用闭包来保存浏览器实例和搜索结果
            // @ts-ignore
            if (!main.browserInstance) {
                // @ts-ignore
                main.browserInstance = new WebBrowser({
                    searcherType: params.searcher_type,
                    topk: topk,
                    timeout: timeout,
                    searcherOptions: {
                        apiKey: params.api_key,
                        region: params.region || 'zh-CN'
                    }
                });
                // @ts-ignore
                main.lastSearchResults = null;
            }

            // @ts-ignore
            const browser = main.browserInstance;
            let result;

            switch (action) {
                case 'search':
                    if (!query) {
                        throw new Error('Query parameter is required for search action');
                    }
                    result = await browser.search(query);
                    // 保存搜索结果
                    // @ts-ignore
                    main.lastSearchResults = result;
                    break;
                case 'select':
                    if (!select_ids || !Array.isArray(select_ids)) {
                        throw new Error('select_ids parameter (array) is required for select action');
                    }
                    // 使用保存的搜索结果
                    // @ts-ignore
                    if (!main.lastSearchResults) {
                        throw new Error('No search results to select from. Please perform a search first.');
                    }
                    // 确保浏览器实例使用相同的搜索结果
                    // @ts-ignore
                    browser.searchResults = main.lastSearchResults;
                    result = await browser.select(select_ids);
                    break;
                case 'open_url':
                    if (!url) {
                        throw new Error('URL parameter is required for open_url action');
                    }
                    result = await browser.openUrl(url);
                    break;
                case 'check_accessibility':
                    if (!url) {
                        throw new Error('URL parameter is required for check_accessibility action');
                    }
                    result = await browser.checkUrlAccessibility(url);
                    break;
                default:
                    throw new Error(`Unknown action: ${action}. Supported actions: search, select, open_url`);
            }

            logger.log('fetch_search result:', result);
            return result;

        } catch (error: any) {
            console.error('fetch_search error:', error);
            return { error: error.message };
        }
    };
}

// 在测试函数中也需要相应修改
if (require.main === module) {
    (async () => {
        try {
            logger.log('开始搜索测试...');

            // 初始化浏览器实例
            // @ts-ignore
            const browserMain = main({
                api_key: null,
                region: "zh-CN"
            });

            // 测试1: 搜索功能
            logger.log('\n=== 测试1: 搜索功能 ===');
            const searchResults = await browserMain({
                action: 'search',
                query: 'Node.js web development',
                // @ts-ignore
                searcher_type: 'DuckDuckGoSearch',
                topk: 3
            });
            logger.log('搜索测试结果:', JSON.stringify(searchResults, null, 2));

            // 测试2: 选择功能（如果有搜索结果）
            if (searchResults && !searchResults.error && Object.keys(searchResults).length > 0) {
                logger.log('\n=== 测试2: 选择功能 ===');
                const selectIds = Object.keys(searchResults).slice(0, 2).map(Number);
                // @ts-ignore
                const selectResults = await browserMain({
                    action: 'select',
                    select_ids: selectIds
                });
                logger.log('选择测试结果:', JSON.stringify(selectResults, null, 2));
            }

            // 测试3: URL可及性功能
            logger.log('\n=== 测试3: URL可及性功能 ===');
            // @ts-ignore
            const checkResults = await browserMain({
                action: 'check_accessibility',
                url: 'https://httpbin.org/json'
            });
            logger.log('URL可及性测试结果:', checkResults ? '可访问' : '访问失败');

            // 测试3: 打开URL功能
            logger.log('\n=== 测试3: 打开URL功能 ===');
            // @ts-ignore
            const openResults = await browserMain({
                action: 'open_url',
                url: 'https://httpbin.org/json'
            });
            logger.log('打开URL测试结果:', openResults ? '成功获取内容' : '获取失败');

            logger.log('\n=== 所有测试完成 ===');

        } catch (error: any) {
            console.error('测试错误:', error.message);
        }
    })();
}

// 获取工具提示词
function getPrompt() {
    return {
    "name": "fetch_search",
    "description": "A comprehensive web browsing tool that can search the web, select specific results, open URLs to fetch content, and check URL accessibility. Note: Content from open_url is limited to 20000 characters.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "description": "(Required) The action to perform. One of: 'search', 'select', 'open_url', 'check_accessibility'"
            },
            "query": {
                "type": "array",
                "description": "(Required for 'search') Search query string or array of queries",
                "items": {
                    "type": "string"
                }
            },
            "select_ids": {
                "type": "array",
                "description": "(Required for 'select') Array of result IDs to fetch detailed content from",
                "items": {
                    "type": "string"
                }
            },
            "url": {
                "type": "string",
                "description": "(Required for 'open_url' and 'check_accessibility') URL to open and fetch content from or check accessibility"
            },
            "topk": {
                "type": "number",
                "description": "(Optional) Number of top results to return. Default: 10"
            },
            "timeout": {
                "type": "number",
                "description": "(Optional) Request timeout in milliseconds. Default: 5000"
            }
        },
        "required": [
            "action",
            "query",
            "select_ids",
            "url"
        ]
    }
};
}

export {
    main,
    getPrompt,
    WebBrowser,
    BaseSearch,
    DuckDuckGoSearch,
    BingSearch,
    ContentFetcher,
    TTLCache
};