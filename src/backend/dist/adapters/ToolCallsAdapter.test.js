"use strict";
// ToolCallsAdapter 测试文件 - 从统一 Message 格式提取工具调用
Object.defineProperty(exports, "__esModule", { value: true });
const ToolCallsAdapter_1 = require("./ToolCallsAdapter");
describe('ToolCallsAdapter Unit Tests', () => {
    let adapter;
    beforeEach(() => {
        adapter = new ToolCallsAdapter_1.ToolCallsAdapter();
    });
    describe('formatTools', () => {
        it('应该将工具格式化为 OpenAI function 格式', () => {
            const schemas = [{
                    name: 'search',
                    description: 'Search the web',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query' }
                        },
                        required: ['query']
                    }
                }];
            const result = adapter.formatTools(schemas);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: 'function',
                function: schemas[0]
            });
        });
        it('应该过滤掉 raw_string 类型', () => {
            const schemas = [
                { type: 'raw_string', name: 'raw_tool', content: 'raw content' },
                { name: 'normal_tool', description: 'A normal tool' }
            ];
            const result = adapter.formatTools(schemas);
            expect(result).toHaveLength(1);
            expect(result[0].function.name).toBe('normal_tool');
        });
        it('应该处理空数组', () => {
            const result = adapter.formatTools([]);
            expect(result).toEqual([]);
        });
    });
    describe('getToolInfos - OpenAI 格式', () => {
        it('应该从 OpenAI 格式 tool_calls 提取工具调用', () => {
            const message = {
                role: 'assistant',
                content: 'I will search for that.',
                tool_calls: [{
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'search',
                            arguments: '{"query": "weather", "location": "Beijing"}'
                        }
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool).toBe('search');
            expect(result[0].params).toEqual({ query: 'weather', location: 'Beijing' });
            expect(result[0].id).toBe('call_123');
            expect(result[0].content).toBe('I will search for that.');
        });
        it('应该处理多个 tool_calls', () => {
            const message = {
                role: 'assistant',
                content: 'Let me do multiple things.',
                tool_calls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'search', arguments: '{"q": "test"}' }
                    },
                    {
                        id: 'call_2',
                        type: 'function',
                        function: { name: 'read_file', arguments: '{"path": "/tmp/test"}' }
                    }
                ]
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(2);
            expect(result[0].tool).toBe('search');
            expect(result[1].tool).toBe('read_file');
        });
        it('应该处理已解析的 arguments 对象', () => {
            const message = {
                role: 'assistant',
                content: 'Done.',
                tool_calls: [{
                        id: 'call_1',
                        type: 'function',
                        function: {
                            name: 'search',
                            arguments: { query: 'test', limit: 10 }
                        }
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result[0].params).toEqual({ query: 'test', limit: 10 });
        });
    });
    describe('getToolInfos - Anthropic 格式', () => {
        it('应该从 Anthropic 格式提取工具调用', () => {
            const message = {
                role: 'assistant',
                content: 'I will search.',
                tool_calls: [{
                        id: 'toolu_123',
                        name: 'search',
                        input: '{"query": "test"}'
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool).toBe('search');
            expect(result[0].params).toEqual({ query: 'test' });
        });
    });
    describe('getToolInfos - 纯文本', () => {
        it('应该处理无 tool_calls 的纯文本消息', () => {
            const message = {
                role: 'assistant',
                content: 'This is a regular response without any tool calls.'
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool).toBeNull();
            expect(result[0].content).toBe('This is a regular response without any tool calls.');
            expect(result[0].params).toEqual({});
        });
    });
    describe('getToolInfos - Reasoning', () => {
        it('应该提取 reasoning_content', () => {
            const message = {
                role: 'assistant',
                content: 'Here is the result.',
                reasoning_content: 'I need to think about this step by step.',
                tool_calls: [{
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'search', arguments: '{}' }
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result[0].reasoning_content).toBe('I need to think about this step by step.');
        });
    });
    describe('getToolInfos - Error Handling', () => {
        it('应该处理无效的 JSON arguments', () => {
            const message = {
                role: 'assistant',
                content: 'Attempting...',
                tool_calls: [{
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'search', arguments: 'not valid json {' }
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].error).toBeDefined();
            expect(result[0].params).toBe('not valid json {'); // 保留原始字符串
        });
        it('应该处理缺失的字段', () => {
            const message = {
                role: 'assistant',
                content: '...',
                tool_calls: [{
                        id: 'call_1'
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool).toBeNull();
        });
    });
    describe('extractText', () => {
        it('应该提取字符串内容', () => {
            const message = { content: 'Hello world' };
            expect(adapter.extractText(message)).toBe('Hello world');
        });
        it('应该从数组内容中提取文本', () => {
            const message = {
                content: [
                    { type: 'text', text: 'First part' },
                    { type: 'text', text: 'Second part' }
                ]
            };
            expect(adapter.extractText(message)).toBe('First part\nSecond part');
        });
        it('应该处理空内容', () => {
            const message = { content: '' };
            expect(adapter.extractText(message)).toBe('');
        });
    });
});
//# sourceMappingURL=ToolCallsAdapter.test.js.map