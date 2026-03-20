"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_client_1 = require("./browser_client");
describe('BrowserClient & ContentExtractor 单元测试', () => {
    // Puppeteer 启动和执行通常较慢，需要增加 Jest 的默认超时时间
    jest.setTimeout(30000);
    // 确保所有测试结束后，浏览器一定会被清理关闭
    afterAll(async () => {
        await (0, browser_client_1.main)()({ operation: 'close' });
    });
    it('1. 应该能够成功打开浏览器', async () => {
        const result = await (0, browser_client_1.main)()({ operation: 'open' });
        expect(result.success).toBe(true);
        expect(result.message).toContain('成功');
    });
    it('2. 应该能够在浏览器上下文中执行 JavaScript', async () => {
        const result = await (0, browser_client_1.main)()({
            operation: 'execute_js',
            js: '2 + 2',
            wait_after_execution: 0
        });
        expect(result.success).toBe(true);
        // 使用 as any 绕过联合类型的严格检查
        expect(result.data.result).toBe(4);
    });
    it('3. 应该能够导航并提取纯文本内容', async () => {
        // 使用 data URL 注入一个静态页面，避免测试时的网络依赖
        const html = `
            <!DOCTYPE html>
            <html>
            <head><title>Test Page</title></head>
            <body>
                <main>
                    <h1>Hello Puppeteer</h1>
                    <p>这是一个用于测试的纯文本段落。</p>
                    <script>console.log("这段脚本应该被清理掉")</script>
                </main>
            </body>
            </html>
        `;
        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        const result = await (0, browser_client_1.main)()({
            operation: 'get_content',
            action: 'extractText',
            url: dataUrl
        });
        expect(result.success).toBe(true);
        // 断言具体的数据结构
        const responseData = result.data;
        expect(responseData.page_info.title).toBe('Test Page');
        // 验证文本提取功能
        const extractedText = responseData.content.content;
        expect(extractedText).toContain('Hello Puppeteer');
        expect(extractedText).toContain('这是一个用于测试的纯文本段落。');
        // 验证 script 标签是否按预期被清理
        expect(extractedText).not.toContain('这段脚本应该被清理掉');
    });
    it('4. 应该能够获取 DOM 元素信息', async () => {
        const result = await (0, browser_client_1.main)()({
            operation: 'get_element_info',
            selector: 'h1'
        });
        expect(result.success).toBe(true);
        const responseData = result.data;
        expect(responseData.exists).toBe(true);
        expect(responseData.tagName).toBe('H1');
        expect(responseData.textContent).toContain('Hello Puppeteer');
    });
    it('5. 应该能够正常关闭浏览器', async () => {
        const result = await (0, browser_client_1.main)()({ operation: 'close' });
        expect(result.success).toBe(true);
    });
    it('6. 在浏览器关闭后调用其他操作应返回失败信息', async () => {
        const result = await (0, browser_client_1.main)()({
            operation: 'execute_js',
            js: 'console.log("test")'
        });
        expect(result.success).toBe(false);
        expect(result.message).toContain('浏览器未打开');
    });
});
//# sourceMappingURL=browser_client.test.js.map