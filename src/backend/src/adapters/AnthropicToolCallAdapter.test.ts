import { AnthropicToolCallAdapter } from './AnthropicAdapter';
import { Message } from '../types';

describe('AnthropicToolCallAdapter Unit Tests', () => {
    let adapter: AnthropicToolCallAdapter;

    beforeEach(() => {
        adapter = new AnthropicToolCallAdapter();
    });

    describe('formatTools', () => {
        it('应该将标准 Schema 转换为 Anthropic custom 工具格式并过滤 raw_string', () => {
            const schemas = [
                { type: 'raw_string' },
                {
                    name: 'get_weather',
                    description: 'Get local weather',
                    parameters: { type: 'object', properties: { location: { type: 'string' } } }
                },
                {
                    name: 'get_time',
                    // 测试缺失 parameters 时是否能提供默认 input_schema
                }
            ];

            const result = adapter.formatTools(schemas);

            expect(result).toHaveLength(2);
            expect(result[0].type).toBe('custom');
            expect(result[0].name).toBe('get_weather');
            expect(result[0].input_schema.properties.location.type).toBe('string');

            // 验证兜底的默认参数
            expect(result[1].name).toBe('get_time');
            expect(result[1].input_schema).toEqual({ type: 'object', properties: {} });
        });
    });

    describe('getToolInfo', () => {
        it('应该成功解析合法的 ToolCall arguments', () => {
            const mockMessage: Message = {
                role: 'assistant',
                content: 'Checking...',
                tool_calls: [{
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'search', arguments: '{"query": "Jest test"}' }
                }]
            };

            const result = adapter.getToolInfos(mockMessage);

            expect(result.tool).toBe('search');
            expect(result.id).toBe('call_1');
            expect(result.thinking).toBe('Checking...');
            expect(result.params).toEqual({ query: 'Jest test' });
            expect(result.error).toBeNull();
        });

        it('应该安全捕获非法的 JSON arguments', () => {
            const mockMessage: Message = {
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'search', arguments: '{"query": "Jest' } // 截断的 JSON
                }]
            };

            const result = adapter.getToolInfos(mockMessage);

            expect(result.tool).toBe('search');
            expect(result.params).toBe('{"query": "Jest'); // 保留原始残缺文本
            expect(result.error).toContain('Arguments are not a pure JSON text');
        });
    });

    describe('extractText', () => {
        it('当 content 是 Anthropic Block 数组时应该提取 text 类型的内容', () => {
            const message = {
                content: [
                    { type: 'tool_use', id: '123' },
                    { type: 'text', text: 'Here is the result' } // 这里没有 official
                ]
            };
            // 修正期望值，去掉多余的 official
            expect(adapter.extractText(message)).toBe('Here is the result');
        });

        it('当 content 是普通纯文本时应该直接返回', () => {
            const message = { content: 'Pure string text' };
            expect(adapter.extractText(message)).toBe('Pure string text');
        });

        it('当 content 无法匹配时应该返回空字符串', () => {
            const message = { content: [{ type: 'image', source: {} }] };
            expect(adapter.extractText(message)).toBe('');
        });
    });
});