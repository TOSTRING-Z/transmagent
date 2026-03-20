"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fetch_url_1 = require("./fetch_url");
// 模拟 logger，保持控制台整洁
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        error: jest.fn()
    }
}));
describe('fetch_url tool', () => {
    // 保存原始的 fetch 以便恢复
    const originalFetch = global.fetch;
    beforeEach(() => {
        jest.clearAllMocks();
        // 劫持全局 fetch
        global.fetch = jest.fn();
    });
    afterAll(() => {
        // 恢复原始环境
        global.fetch = originalFetch;
    });
    it('1. 应该能够成功抓取网页并提取、清理正文', async () => {
        // 构造一个包含样式、脚本、连续换行和空格的脏 HTML
        const mockHtml = `
            <html>
                <head><style>body { color: red; }</style></head>
                <body>
                    <h1>Hello   World</h1>
                    <p>This is a 
                    
                    test paragraph.</p>
                    <script>console.log("ignore me");</script>
                </body>
            </html>
        `;
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => mockHtml
        });
        const result = await (0, fetch_url_1.main)()({ url: 'https://example.com' });
        expect(result.error).toBeUndefined();
        expect(result.url).toBe('https://example.com');
        // 验证 script 和 style 是否被安全移除，且多余的换行和空格被成功压缩
        expect(result.text).toBe('Hello World This is a test paragraph.');
    });
    it('2. 应该能根据 text_max_len 截断超长内容', async () => {
        // 构造超长文本
        const mockHtml = `<body>${'A '.repeat(2000)}</body>`;
        global.fetch.mockResolvedValue({
            ok: true,
            text: async () => mockHtml
        });
        // 限制只返回前 10 个字符
        const result = await (0, fetch_url_1.main)()({ url: 'https://example.com', text_max_len: 10 });
        expect(result.text?.length).toBe(10);
        expect(result.text).toBe('A A A A A ');
    });
    it('3. 遇到 HTTP 错误应该返回状态码等错误信息', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            status: 404
        });
        const result = await (0, fetch_url_1.main)()({ url: 'https://example.com/404' });
        expect(result.text).toBeUndefined();
        expect(result.error).toBe('HTTP error! status: 404');
    });
    it('4. 遇到网络底层异常应捕获并返回', async () => {
        global.fetch.mockRejectedValue(new Error('fetch failed'));
        const result = await (0, fetch_url_1.main)()({ url: 'https://example.com/timeout' });
        expect(result.text).toBeUndefined();
        expect(result.error).toBe('fetch failed');
    });
    it('5. 缺少 URL 参数时应直接返回错误', async () => {
        // 故意传入空对象
        const result = await (0, fetch_url_1.main)()({});
        expect(result.error).toBe('URL parameter is required');
    });
    it('6. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = (0, fetch_url_1.getPrompt)();
        expect(prompt.name).toBe('fetch_url');
        expect(prompt.parameters.required).toContain('url');
    });
});
//# sourceMappingURL=fetch_url.test.js.map