import { main, getPrompt } from './error_solution_search';
import * as puppeteer from 'puppeteer';

// 设置全局测试超时为 30 秒
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

    it('1. 参数检查：不提供 error_message 时返回错误', async () => {
        const result = await main({} as any);
        expect(result.success).toBe(false);
        expect(result.error).toBe('error_message parameter is required');
    });

    it('2. 应该能够分析出正确的错误类型 (Error Type)', async () => {
        // 模拟提取结果为空，只关注 error_type 分析
        mockPage.evaluate.mockResolvedValue([]);

        const resultPython = await main({ error_message: 'ModuleNotFoundError: No module named numpy' });
        expect(resultPython.error_type).toContain('python');

        const resultR = await main({ error_message: "Error: package 'dplyr' is not available" });
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

        const result = await main({ error_message: 'test error', max_results: 1 });
        expect(result.success).toBe(true);
        expect(result.solutions.length).toBeGreaterThan(0);
        expect(result.solutions[0].title).toBe('Fixed Error');
    });

    it('4. 验证码页面超时处理', async () => {
        // 模拟初始进入验证码页
        mockPage.url.mockResolvedValue('https://stackoverflow.com/nocaptcha');
        
        // 模拟页面状态始终处于“正在验证”
        mockPage.evaluate.mockResolvedValue({
            hasResults: false,
            stillVerifying: true,
            isSearchPage: false,
            title: 'Captcha'
        });

        // 这里不使用 FakeTimers，因为业务逻辑里有多个 await Promise，FakeTimers 容易死锁
        // 我们改为通过逻辑让其快速超时或手动控制
        const result = await main({ error_message: 'test' });
        
        expect(result.success).toBe(true); 
        expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('5. 启动失败异常捕获', async () => {
        // 模拟 launch 彻底抛出异常
        (puppeteer.launch as jest.Mock).mockImplementationOnce(() => {
            throw new Error('Chrome binary not found');
        });

        const result = await main({ error_message: 'test error' });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Chrome binary not found');
    });
});