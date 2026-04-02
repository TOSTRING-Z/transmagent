"use strict";
// 注意：PromptAdapter 已移除，统一使用 OpenAIAdapter 作为 OpenAI 兼容格式的适配器
// 此文件保留用于 ToolCallsAdapter 和 PromptToolCallAdapter 的测试参考
Object.defineProperty(exports, "__esModule", { value: true });
const ToolCallsAdapter_1 = require("./ToolCallsAdapter");
const PromptAdapter_1 = require("./PromptAdapter");
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
                        }
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
    });
    describe('getToolInfos', () => {
        it('应该从 tool_calls 中提取工具调用信息', () => {
            const message = {
                role: 'assistant',
                content: 'I will search for that.',
                tool_calls: [{
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'search',
                            arguments: '{"query": "test"}'
                        }
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool_call_name).toBe('search');
            expect(result[0].params).toEqual({ query: 'test' });
            expect(result[0].tool_call_id).toBe('call_123');
        });
        it('应该处理纯文本消息（无工具调用）', () => {
            const message = {
                role: 'assistant',
                content: 'This is a regular response.'
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool_call_name).toBeNull();
            expect(result[0].content).toBe('This is a regular response.');
        });
        it('应该提取 reasoning_content', () => {
            const message = {
                role: 'assistant',
                content: 'Let me think about this.',
                reasoning_content: 'I should search for information.',
                tool_calls: [{
                        id: 'call_456',
                        type: 'function',
                        function: {
                            name: 'search',
                            arguments: '{}'
                        }
                    }]
            };
            const result = adapter.getToolInfos(message);
            expect(result[0].reasoning_content).toBe('I should search for information.');
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
    });
});
describe('PromptToolCallAdapter Unit Tests', () => {
    let adapter;
    beforeEach(() => {
        adapter = new PromptAdapter_1.PromptToolCallAdapter();
    });
    describe('formatTools', () => {
        it('应该将工具格式化为 prompt 格式', () => {
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
            expect(result).toHaveProperty('search');
            expect(result['search']).toContain('### search');
            expect(result['search']).toContain('Search the web');
        });
    });
    describe('getToolInfos', () => {
        it('应该从 JSON 字符串中解析工具调用', () => {
            const message = {
                role: 'assistant',
                content: JSON.stringify({
                    tool: 'search',
                    params: { query: 'test' },
                    id: 'call_1'
                })
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool_call_name).toBe('search');
            expect(result[0].params).toEqual({ query: 'test' });
        });
        it('应该处理纯文本（无工具调用）', () => {
            const message = {
                role: 'assistant',
                content: 'This is just text without tool calls.'
            };
            const result = adapter.getToolInfos(message);
            expect(result.length).toBe(1);
            expect(result[0].tool_call_name).toBeNull();
            expect(result[0].content).toBe('This is just text without tool calls.');
        });
    });
});
//# sourceMappingURL=PromptAdapter.test.js.map