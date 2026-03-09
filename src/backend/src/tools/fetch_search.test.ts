import { 
    TTLCache, 
    DuckDuckGoSearch, 
    ContentFetcher, 
    WebBrowser, 
    main 
} from './fetch_search';

// Mock logger 防止测试控制台输出过多干扰
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

describe('Fetch & Search Tools', () => {

    describe('TTLCache', () => {
        it('应该能正常存储并获取未过期的值', () => {
            const cache = new TTLCache<string>(10, 60);
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
        });

        it('当超过 maxSize 时应该驱逐最早的键', () => {
            const cache = new TTLCache<string>(2, 60);
            cache.set('k1', 'v1');
            cache.set('k2', 'v2');
            cache.set('k3', 'v3');
            // k1 应该被移除
            expect(cache.get('k1')).toBeUndefined();
            expect(cache.get('k3')).toBe('v3');
        });

        it('当 ttl 过期时应该返回 undefined', () => {
            // 使用 Jest 假时间
            jest.useFakeTimers();
            const cache = new TTLCache<string>(10, 1); // 1秒过期
            cache.set('k', 'v');
            
            jest.advanceTimersByTime(1100); // 快进 1.1 秒
            expect(cache.get('k')).toBeUndefined();
            
            jest.useRealTimers();
        });
    });

    describe('WebBrowser Orchestration', () => {
        let browser: WebBrowser;

        beforeEach(() => {
            browser = new WebBrowser();
            // Mock Searcher
            jest.spyOn(browser.searcher, 'search').mockResolvedValue({
                0: { url: 'https://example.com/1', title: 'Example 1', summ: 'Desc 1' },
                1: { url: 'https://example.com/2', title: 'Example 2', summ: 'Desc 2' }
            });

            // Mock Fetcher
            jest.spyOn(browser.fetcher, 'fetch').mockImplementation(async (url: string) => {
                if (url.includes('error')) return [false, 'Network Error'];
                return [true, `Content for ${url}`];
            });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('1. search 行为应该聚合搜索结果', async () => {
            const results = await browser.search('test query');
            expect(results).toHaveProperty('0');
            expect(results[0].url).toBe('https://example.com/1');
        });

        it('2. select 行为应该拉取具体网页内容', async () => {
            await browser.search('test query'); // 产生内部 searchResults 状态
            const selected = await browser.select([0]);
            
            expect(selected[0].content).toBe('Content for https://example.com/1');
            expect(selected[0].summ).toBeUndefined(); // select 会删除 summ
        });

        it('3. open_url 行为应该返回截断保护后的内容', async () => {
            const result = await browser.openUrl('https://example.com/direct');
            expect(result.type).toBe('text');
            expect(result.content).toBe('Content for https://example.com/direct');
        });
    });

    describe('Main Action Router', () => {
        let actionRunner: ReturnType<typeof main>;

        beforeEach(() => {
            actionRunner = main({ searcher_type: 'DuckDuckGoSearch' });

            // 为了测试稳定，拦截全局 fetch 和 WebBrowser 方法
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'content-type': 'text/html' }),
                url: 'https://example.com'
            });
        });

        it('处理 check_accessibility 正常', async () => {
            const res = await actionRunner({
                action: 'check_accessibility',
                url: 'https://example.com',
                query: [],
                select_ids: []
            });

            expect(res.accessible).toBe(true);
            expect(res.status).toBe(200);
        });

        it('处理无效参数时抛出明确的 Error string', async () => {
            const res = await actionRunner({
                action: 'search',
                // 故意缺失 query
            } as any);

            expect(res.error).toBe('Query parameter is required for search action');
        });
    });
});