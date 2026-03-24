import { PromptToolCallAdapter } from './PromptAdapter';
import { Message } from '../types';
import { utils } from '../utils/globals';

// Mock 外部依赖
jest.mock('../utils/globals', () => ({
    utils: {
        parseJsonContent: jest.fn()
    }
}));

describe('PromptToolCallAdapter Unit Tests', () => {
    let adapter: PromptToolCallAdapter;

    beforeEach(() => {
        adapter = new PromptToolCallAdapter();
        jest.clearAllMocks();
    });

    describe('formatTools', () => {
        it('应该正确格式化 raw_string 和标准的 Object Schema 为纯文本 Prompt', () => {
            const schemas = [
                { type: 'raw_string', name: 'custom_rule', content: 'Always return JSON.' },
                {
                    name: 'get_weather',
                    description: 'Get local weather',
                    parameters: {
                        type: 'object',
                        properties: { location: { type: 'string', description: 'City name' } },
                        required: ['location']
                    }
                }
            ];

            const result = adapter.formatTools(schemas);

            // 验证 raw_string 直接映射
            expect(result['custom_rule']).toBe('Always return JSON.');

            // 验证标准 Schema 被转换为 Markdown 格式的提示词说明
            const weatherPrompt = result['get_weather'];
            expect(weatherPrompt).toContain('### get_weather');
            expect(weatherPrompt).toContain('Description: Get local weather');
            expect(weatherPrompt).toContain('- location: (Required) City name');
            expect(weatherPrompt).toContain('"tool": "get_weather"'); // 验证 Usage 示例生成
        });
    });

    describe('extractText', () => {
        it('应该正确提取文本', () => {
            expect(adapter.extractText({ content: 'test string' })).toBe('test string');
            expect(adapter.extractText({ content: [{ type: 'text' }] })).toBe('');
        });
    });
});