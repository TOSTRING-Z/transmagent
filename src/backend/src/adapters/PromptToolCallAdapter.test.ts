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

    describe('getToolInfo', () => {
        it('应该成功解析包含合法 JSON 的文本为工具调用', () => {
            const mockMessage: Message = {
                role: 'assistant',
                content: '{"thinking": "checking weather", "tool": "weather", "params": {"city": "Tokyo"}}'
            };

            // 模拟 utils.parseJsonContent 无法解析时，自动降级为 JSON5.parse
            (utils.parseJsonContent as jest.Mock).mockReturnValueOnce(null);

            const result = adapter.getToolInfo(mockMessage);

            expect(result.thinking).toBe('checking weather');
            expect(result.tool).toBe('weather');
            expect(result.params).toEqual({ city: 'Tokyo' });
            expect(result.error).toBeNull();
        });

        it('当内容以 { 或 ```json 开头但 JSON 格式错误时，应该记录解析错误', () => {
            const mockMessage: Message = {
                role: 'assistant',
                content: '{\n  "thinking": "checking",\n  "tool": "weather"' // 截断的 JSON
            };

            (utils.parseJsonContent as jest.Mock).mockReturnValueOnce(null);

            const result = adapter.getToolInfo(mockMessage);

            expect(result.tool).toBeNull();
            expect(result.error).toContain('Error Message:');
            // 验证生成的 thinking 内容包含错误提示和原始报错文本
            expect(result.thinking).toContain('Function calling is not a pure JSON text');
            expect(result.thinking).toContain('"tool": "weather"');
        });

        it('当内容为普通纯文本时，应该作为正常的思考/聊天内容返回', () => {
            const mockMessage: Message = {
                role: 'assistant',
                content: 'Hello, I am a standard AI response without any JSON.'
            };

            (utils.parseJsonContent as jest.Mock).mockReturnValueOnce(null);

            const result = adapter.getToolInfo(mockMessage);

            expect(result.tool).toBeNull();
            expect(result.thinking).toBe('Hello, I am a standard AI response without any JSON.');
            expect(result.error).toBeNull();
        });
    });

    describe('extractText', () => {
        it('应该正确提取文本', () => {
            expect(adapter.extractText({ content: 'test string' })).toBe('test string');
            expect(adapter.extractText({ content: [{ type: 'text' }] })).toBe('');
        });
    });
});