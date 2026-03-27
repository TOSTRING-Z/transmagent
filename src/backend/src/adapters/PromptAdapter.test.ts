import { PromptAdapter } from './PromptAdapter';
import { ChatRequestData, Message } from '../types';

describe('PromptAdapter Unit Tests', () => {
    let adapter: PromptAdapter;
    let data: ChatRequestData;

    beforeEach(() => {
        adapter = new PromptAdapter();
        data = {
            id: "string",
            input: "string",
            tool_format: "string",
            api_url: "string",
            version: "string",
            params: { ollama: true, vision: ['image'] },
            todolist_message: "string",
            env_message: 'Current time is 10 AM'
        }
        // 彻底重置 fetch Mock
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('formatMessages', () => {
        it('应该将 tool 角色转换为 user', () => {
            const messages: Message[] = [{ role: 'tool', content: 'result' }];
            const result = adapter.formatMessages(messages, data);

            expect(result[0].role).toBe('user');
            expect(result[0].content).toBe('result');
        });

        it('针对 Ollama 且存在图文混合时，应该正确提取 base64 并组合 OllamaContent', () => {
            const messages: Message[] = [{
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe this' },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo...' } }
                ]
            }];

            // 关键：必须传入 vision 参数，否则会被逻辑第一步过滤掉图片
            const result = adapter.formatMessages(messages, data);

            expect(result[0].role).toBe('user');
            expect(result[0].content).toBe('Describe this');
            // 验证生成的 Ollama 特有字段
            expect(result[0]).toHaveProperty('images');
            expect(result[0].images).toEqual(['iVBORw0KGgo...']);
        });

        it('如果传入 env_message，应该追加到最后一条消息的末尾', () => {
            const messages: Message[] = [{ role: 'user', content: 'What time is it?' }];

            const result = adapter.formatMessages(messages, data);

            expect(result[0].content).toBe('What time is it?\nCurrent time is 10 AM');
        });
    });

    describe('buildPayload', () => {
        it('应该构建 Payload 且故意不传入 tools 参数', () => {
            const data: Partial<ChatRequestData> = {
                version: 'llama3',
                llm_params: { temperature: 0.5 },
                tools: [{ type: 'function', function: { name: 'test' } }] as any
            };
            const messages: Message[] = [{ role: 'user', content: 'Hi' }];

            const result = adapter.buildPayload(data as ChatRequestData, messages);

            expect(result.model).toBe('llama3');
            expect(result.tools).toBeUndefined(); // 确保被丢弃
        });
    });

    describe('truncatedResponse (Async Continuation)', () => {
        it('应该通过纯文本续写完成被截断的回答', async () => {
            // 准备 Mock 响应
            const mockJsonResponse = {
                choices: [{ message: { content: 'there was a hero.' }, finish_reason: 'stop' }],
                usage: { total_tokens: 25 }
            };

            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockJsonResponse
            });

            const mockBody = { messages: [{ role: 'user', content: 'Tell me a story.' }] };
            const mockHeaders = { 'Content-Type': 'application/json' };
            const mockWindow = { webContents: { send: jest.fn() } };
            const mockChatManager = { chat: { group_id: '1', tokens: 10 } };

            // 核心修复：api_url 必须是合法完整的 URL 字符串
            const mockData: Partial<ChatRequestData> = {
                api_url: 'http://localhost:11434/v1/chat',
                output: 'Once upon a time, '
            };
            const mockMessageOutput = { content: 'Once upon a time, ' };

            await adapter.truncatedResponse(
                mockBody,
                mockHeaders,
                mockWindow,
                mockChatManager,
                mockMessageOutput,
                mockData as ChatRequestData
            );

            // 验证 fetch 是否被调用
            expect(global.fetch).toHaveBeenCalled();

            // 安全地获取调用参数并验证
            const calls = (global.fetch as jest.Mock).mock.calls;
            expect(calls.length).toBeGreaterThan(0);

            const fetchOptions = calls[0][1];
            const sentBody = JSON.parse(fetchOptions.body);

            expect(sentBody.messages[1].role).toBe('assistant');
            expect(sentBody.messages[1].content).toBe('Once upon a time, ');
            expect(mockMessageOutput.content).toBe('Once upon a time, there was a hero.');
        });
    });
});