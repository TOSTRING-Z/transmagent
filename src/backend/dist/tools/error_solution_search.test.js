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
const error_solution_search_1 = require("./error_solution_search");
const puppeteer = __importStar(require("puppeteer"));
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
    let mockPage;
    let mockBrowser;
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
        puppeteer.launch.mockResolvedValue(mockBrowser);
    });
    afterEach(() => {
        // 清理 Date.now 的 mock
        jest.restoreAllMocks();
    });
    it('1. 参数检查：不提供 error_message 时返回错误', async () => {
        const result = await (0, error_solution_search_1.main)()({});
        expect(result.success).toBe(false);
        expect(result.error).toBe('error_message parameter is required');
    });
    it('2. 应该能够分析出正确的错误类型 (Error Type)', async () => {
        mockPage.evaluate.mockResolvedValue([]);
        const resultPython = await (0, error_solution_search_1.main)()({ error_message: 'ModuleNotFoundError: No module named numpy' });
        expect(resultPython.error_type).toContain('python');
        const resultR = await (0, error_solution_search_1.main)()({ error_message: "Error: package 'dplyr' is not available" });
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
        const result = await (0, error_solution_search_1.main)()({ error_message: 'test error', max_results: 1 });
        expect(result.success).toBe(true);
        expect(result.solutions.length).toBeGreaterThan(0);
        expect(result.solutions[0].title).toBe('Fixed Error');
    });
    it('4. 验证码页面超时处理', async () => {
        mockPage.url.mockResolvedValue('https://stackoverflow.com/nocaptcha');
        // 【核心修复】：根据 evaluate 传入的页面执行函数内容，智能返回不同类型的数据
        mockPage.evaluate.mockImplementation((fn) => {
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
        const result = await (0, error_solution_search_1.main)()({ error_message: 'test' });
        expect(result.success).toBe(true);
        expect(result.solutions_count).toBe(0);
        expect(mockBrowser.close).toHaveBeenCalled();
    });
    it('5. 启动失败异常捕获', async () => {
        puppeteer.launch.mockImplementationOnce(() => {
            throw new Error('Chrome binary not found');
        });
        const result = await (0, error_solution_search_1.main)()({ error_message: 'test error' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Chrome binary not found');
    });
    it('6. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = (0, error_solution_search_1.getPrompt)();
        expect(prompt.name).toBe('error_solution_search');
        expect(prompt.parameters.required).toContain('error_message');
    });
});
//# sourceMappingURL=error_solution_search.test.js.map