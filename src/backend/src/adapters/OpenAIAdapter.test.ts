import { OpenAIAdapter } from './OpenAIAdapter';
import { ChatRequestData } from '../types';

describe('OpenAIAdapter Advanced Methods', () => {
    let adapter: OpenAIAdapter;

    beforeEach(() => {
        adapter = new OpenAIAdapter();
        // 拦截全局 fetch，用于测试 truncatedResponse
        global.fetch = jest.fn();
    });

    afterEach(() => {
        // 每个用例跑完后清理 Mock
        jest.restoreAllMocks();
    });

    describe('buildPayload', () => {
        it('应该正确构建基础 Payload 并自动追加 stream_options', () => {
            const data: Partial<ChatRequestData> = {
                version: 'gpt-4o',
                llm_params: { temperature: 0.7, stream: true }
            };
            const formattedMessages = [{ role: 'user', content: 'Hi' }];

            const result = adapter.buildPayload(data as ChatRequestData, formattedMessages);

            expect(result.model).toBe('gpt-4o');
            expect(result.temperature).toBe(0.7);
            expect(result.messages).toEqual(formattedMessages);
            // 确保针对非 Claude 模型且开启流式输出时，默认开启 token 统计
            expect(result.stream_options).toEqual({ include_usage: true });
        });

        it('当包含 tools 时，应该正确注入 tools 和 tool_choice', () => {
            const data: Partial<any> = {
                version: 'gpt-3.5-turbo',
                llm_params: {},
                tools: [{ type: 'function', function: { name: 'get_time' } }]
            };

            const result = adapter.buildPayload(data as ChatRequestData, []);

            expect(result.tools).toHaveLength(1);
            expect(result.tool_choice).toBe('auto');
        });
    });

    describe('buildHeaders', () => {
        it('应该正确注入 Bearer Token', () => {
            const data: Partial<ChatRequestData> = { api_key: 'sk-123456' };
            const headers = adapter.buildHeaders(data as ChatRequestData);

            expect(headers['Content-Type']).toBe('application/json');
            expect(headers['Authorization']).toBe('Bearer sk-123456');
        });
    });

    describe('parseStreamChunk & parseResponse', () => {
        it('parseStreamChunk 应该正确解析增量结构', () => {
            const chunk = {
                choices: [{ delta: { content: 'Hello' } }],
                usage: { total_tokens: 15 }
            };
            
            const result = adapter.parseStreamChunk(chunk);
            expect(result.content).toBe('Hello');
            expect(result.tokens).toBe(15);
        });

        it('parseResponse 应该正确提取全量结果和 finish_reason', () => {
            const resp = {
                choices: [{
                    message: { content: 'World' },
                    finish_reason: 'stop'
                }],
                usage: { total_tokens: 42 }
            };

            const result = adapter.parseResponse(resp);
            expect(result.content).toBe('World');
            expect(result.finish_reason).toBe('stop');
            expect(result.tokens).toBe(42);
        });
    });

    describe('truncatedResponse (Async Continuation)', () => {
        it('应该能成功续写被截断的 ToolCall JSON 参数', async () => {
            // 1. 准备 Mock 数据环境
            const mockBody = { messages: [{ role: 'user', content: 'What is the weather?' }] };
            const mockHeaders = { 'Authorization': 'Bearer test' };
            const mockWindow = { webContents: { send: jest.fn() } };
            const mockChatManager = { chat: { group_id: 'group_1', tokens: 10 } };
            const mockData: Partial<ChatRequestData> = { 
                api_url: 'https://api.openai.com/v1/chat/completions',
                output: '' 
            };
            
            // 模拟被截断的 messageOutput（JSON 缺了一半）
            const mockMessageOutput = {
                content: '',
                tool_calls: [{
                    function: { arguments: '{"location": "Tokyo", "uni' }
                }]
            };

            // 2. Mock fetch 返回的数据：模拟模型成功补全了剩下的 JSON 字符串，并且 finish_reason 是 stop
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({
                    choices: [{
                        message: { content: 't": "celsius"}' },
                        finish_reason: 'stop'
                    }],
                    usage: { total_tokens: 50 }
                })
            });

            // 3. 执行测试
            await adapter.truncatedResponse(
                mockBody, mockHeaders, mockWindow, mockChatManager, mockMessageOutput, mockData as ChatRequestData
            );

            // 4. 验证断言
            // 验证 fetch 请求的 body 中是否正确移除了 tools
            const fetchCallArgs = (global.fetch as jest.Mock).mock.calls[0];
            const requestBody = JSON.parse(fetchCallArgs[1].body);
            expect(requestBody.tools).toBeUndefined();
            expect(requestBody.messages[1].role).toBe('assistant');
            expect(requestBody.messages[1].content).toBe('{"location": "Tokyo", "uni'); // 发送半截文本

            // 验证截断的 JSON 是否被完美拼接
            expect(mockMessageOutput.tool_calls[0].function.arguments).toBe('{"location": "Tokyo", "unit": "celsius"}');
            
            // 验证是否正确更新了 tokens 和通知了前端
            expect(mockChatManager.chat.tokens).toBe(50);
            expect(mockWindow.webContents.send).toHaveBeenCalledWith(
                'streamData', 
                expect.objectContaining({ content: 't": "celsius"}', is_tool_call_args: true })
            );
        });
    });
});

