"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const OpenAIAdapter_1 = require("./OpenAIAdapter");
describe('OpenAI Adapters Unit Tests', () => {
    describe('OpenAIToolCallAdapter.getToolInfo', () => {
        let toolCallAdapter;
        beforeEach(() => {
            toolCallAdapter = new OpenAIAdapter_1.OpenAIToolCallAdapter();
        });
        it('应该成功解析合法的 ToolCall arguments (纯 JSON)', () => {
            const mockMessage = {
                role: 'assistant',
                content: 'I will check the weather for you.',
                tool_calls: [{
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            arguments: '{"location": "Tokyo", "unit": "celsius"}'
                        }
                    }]
            };
            const result = toolCallAdapter.getToolInfo(mockMessage);
            expect(result.tool).toBe('get_weather');
            expect(result.id).toBe('call_123');
            expect(result.thinking).toBe('I will check the weather for you.');
            expect(result.params).toEqual({ location: 'Tokyo', unit: 'celsius' });
            expect(result.error).toBeNull();
        });
        it('应该安全捕获并处理非法的 JSON arguments', () => {
            const mockMessage = {
                role: 'assistant',
                content: 'Thinking...',
                tool_calls: [{
                        id: 'call_456',
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            // 故意截断或错误的 JSON
                            arguments: '{"location": "Tokyo", "uni'
                        }
                    }]
            };
            const result = toolCallAdapter.getToolInfo(mockMessage);
            expect(result.tool).toBe('get_weather');
            expect(result.id).toBe('call_456');
            // 解析失败时，params 应该保留原始错误字符串
            expect(result.params).toBe('{"location": "Tokyo", "uni');
            // 确保错误信息被正确生成
            expect(result.error).toContain('Arguments are not a pure JSON text');
        });
        it('当没有 tool_calls 时应该返回空壳信息', () => {
            const mockMessage = {
                role: 'assistant',
                content: 'Hello world'
            };
            const result = toolCallAdapter.getToolInfo(mockMessage);
            expect(result.tool).toBeNull();
            expect(result.params).toEqual({});
            expect(result.error).toBeNull();
        });
    });
    describe('OpenAIAdapter.formatMessages', () => {
        let adapter;
        beforeEach(() => {
            adapter = new OpenAIAdapter_1.OpenAIAdapter();
        });
        it('应该正确提取非视觉模型的多模态文本内容', () => {
            const messages = [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is in this image?' },
                        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }
                    ]
                }];
            // params.vision 为 undefined，模拟非视觉模型
            const result = adapter.formatMessages(messages, {});
            expect(result[0].role).toBe('user');
            // 图片对象被过滤，只剩下合并后的纯文本
            expect(result[0].content).toBe('What is in this image?');
        });
        it('应该正确转换 tool 角色的对象 content 为字符串', () => {
            const messages = [{
                    role: 'tool',
                    tool_call_id: 'call_789',
                    // 模拟工具返回的 JSON 对象
                    content: { temperature: 25, condition: 'Sunny' }
                }];
            const result = adapter.formatMessages(messages, {});
            expect(result[0].role).toBe('tool');
            expect(result[0].tool_call_id).toBe('call_789');
            // 对象应被序列化为字符串
            expect(typeof result[0].content).toBe('string');
            expect(result[0].content).toBe('{"temperature":25,"condition":"Sunny"}');
        });
    });
});
//# sourceMappingURL=OpenAIToolCallAdapter.test.js.map