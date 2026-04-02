import { OpenAIAdapter, OpenAIToolCallAdapter } from './OpenAIAdapter';
import { ChatRequestData, Message, ToolMessage } from '../types';

describe('OpenAI Adapters Unit Tests', () => {

    describe('OpenAIAdapter.formatMessages', () => {
        let adapter: OpenAIAdapter;
        let data: ChatRequestData;

        beforeEach(() => {
            adapter = new OpenAIAdapter();
            data = {
                id: "string",
                input: "string",
                tool_format: "toolcalls",
                api_url: "string",
                version: "string",
                api_type: "openai",
                params: { vision: ['image'] },
                todolist_message: "string",
                env_message: 'Current time is 10 AM'
            }
        });

        it('应该正确提取非视觉模型的多模态文本内容', () => {
            const messages: Message[] = [{
                role: 'user',
                content: [
                    { type: 'text', text: 'What is in this image?' },
                    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }
                ]
            }];

            // params.vision 为 undefined，模拟非视觉模型
            const result = adapter.formatMessages(messages, data);

            expect(result[0].role).toBe('user');
            // 图片对象被过滤，只剩下合并后的纯文本
            expect(result[0].content).toBe('What is in this image?');
        });

        it('应该正确转换 tool 角色的对象 content 为字符串', () => {
            const messages: any[] = [{
                role: 'tool',
                tool_call_id: 'call_789',
                // 模拟工具返回的 JSON 对象
                content: { temperature: 25, condition: 'Sunny' } as any
            }];

            const result = adapter.formatMessages(messages, data);

            expect(result[0].role).toBe('tool');
            expect(result[0].tool_call_id).toBe('call_789');
            // 对象应被序列化为字符串
            expect(typeof result[0].content).toBe('string');
            expect(result[0].content).toBe('{"temperature":25,"condition":"Sunny"}');
        });
    });
});