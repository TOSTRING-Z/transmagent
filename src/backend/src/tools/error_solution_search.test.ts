import { main, getPrompt } from './error_solution_search';
import * as puppeteer from 'puppeteer';

jest.setTimeout(30000);

jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../main/windows/WindowManager', () => ({
    WindowManager: {
        instance: {
            alertWindow: {
                show: jest.fn()
            }
        }
    }
}));

jest.mock('puppeteer', () => ({
    launch: jest.fn()
}));

describe('error_solution_search tool', () => {
    let mockPage: any;
    let mockBrowser: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockPage = {
            evaluateOnNewDocument: jest.fn(),
            setUserAgent: jest.fn(),
            setExtraHTTPHeaders: jest.fn(),
            goto: jest.fn(),
            url: jest.fn().mockResolvedValue('https://stackoverflow.com/search?q=test'),
            on: jest.fn(),
            evaluate: jest.fn(),
            reload: jest.fn().mockResolvedValue(null)
        };

        mockBrowser = {
            newPage: jest.fn().mockResolvedValue(mockPage),
            close: jest.fn().mockResolvedValue(null)
        };

        (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
    });

    afterEach(() => {
        // 清理 Date.now 的 mock
        jest.restoreAllMocks();
    });

    it('1. 参数检查：不提供 error_message 时返回错误', async () => {
        const result = await main()({} as any);
        expect(result.success).toBe(false);
        expect(result.error).toBe('error_message parameter is required');
    });

    it('2. 应该能够分析出正确的错误类型 (Error Type)', async () => {
        mockPage.evaluate.mockResolvedValue([]);

        const resultPython = await main()({ error_message: 'ModuleNotFoundError: No module named numpy' });
        expect(resultPython.error_type).toContain('python');

        const resultR = await main()({ error_message: "Error: package 'dplyr' is not available" });
        expect(resultR.error_type).toContain('R');
    });

    it('3. 正常流程下，返回清洗后的数据', async () => {
        mockPage.evaluate.mockResolvedValue([
            {
                title: 'Fixed Error',
                url: 'https://stackoverflow.com/q/1',
                votes: 10,
                answers: 1,
                views: 100,
                is_answered: true
            }
        ]);

        const result = await main()({ error_message: 'test error', max_results: 1 });
        expect(result.success).toBe(true);
        expect(result.solutions.length).toBeGreaterThan(0);
        expect(result.solutions[0].title).toBe('Fixed Error');
    });

    it('4. 验证码页面超时处理', async () => {
        mockPage.url.mockResolvedValue('https://stackoverflow.com/nocaptcha');
        
        // 【核心修复】：根据 evaluate 传入的页面执行函数内容，智能返回不同类型的数据
        mockPage.evaluate.mockImplementation((fn: any) => {
            const fnStr = fn.toString();
            // 如果是在做状态检测
            if (fnStr.includes('stillVerifying')) {
                return {
                    hasResults: false,
                    stillVerifying: true,
                    isSearchPage: false,
                    title: 'Captcha'
                };
            }
            // 如果是在提取搜索结果
            return [];
        });

        // 劫持 Date.now() 直接穿透超时
        jest.spyOn(Date, 'now')
            .mockImplementationOnce(() => 1000)
            .mockImplementation(() => 200000);

        const result = await main()({ error_message: 'test' });
        
        expect(result.success).toBe(true); 
        expect(result.solutions_count).toBe(0);
        expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('5. 启动失败异常捕获', async () => {
        (puppeteer.launch as jest.Mock).mockImplementationOnce(() => {
            throw new Error('Chrome binary not found');
        });

        const result = await main()({ error_message: 'test error' });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Chrome binary not found');
    });

    it('6. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = getPrompt();
        expect(prompt.name).toBe('error_solution_search');
        expect(prompt.parameters.required).toContain('error_message');
    });
});