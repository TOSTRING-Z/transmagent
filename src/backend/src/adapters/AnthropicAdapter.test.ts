import { AnthropicAdapter } from './AnthropicAdapter';
import { ChatRequestData, Message } from '../types';

describe('AnthropicAdapter Unit Tests', () => {
    let adapter: AnthropicAdapter;

    beforeEach(() => {
        adapter = new AnthropicAdapter();
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('formatMessages', () => {
        it('应该过滤掉 system 消息并将 tool 角色转换为 user', () => {
            const messages: Message[] = [
                { role: 'system', content: 'You are an AI' },
                { role: 'tool', tool_call_id: 't_1', content: 'Tool Result Data' }
            ];

            const result = adapter.formatMessages(messages, {});

            expect(result).toHaveLength(1);
            expect(result[0].role).toBe('user'); // tool 被转为 user
            expect(result[0].content[0].type).toBe('tool_result');
            expect(result[0].content[0].tool_use_id).toBe('t_1');
        });

        it('【核心特性】应该合并相邻的同角色消息', () => {
            const messages: Message[] = [
                { role: 'user', content: 'Hello' },
                { role: 'user', content: 'Are you there?' },
                { role: 'assistant', content: 'Yes' },
                { role: 'assistant', content: 'How can I help?' }
            ];

            const result = adapter.formatMessages(messages, {});

            // 原本 4 条消息，合并后应只剩 2 条 (1个 user, 1个 assistant)
            expect(result).toHaveLength(2);
            expect(result[0].role).toBe('user');
            expect(result[0].content).toHaveLength(2); // 内容合并为数组
            expect(result[0].content[0].text).toBe('Hello');
            expect(result[0].content[1].text).toBe('Are you there?');

            expect(result[1].role).toBe('assistant');
            expect(result[1].content).toHaveLength(2);
        });

        it('应该正确转换 assistant 的 tool_calls 为 tool_use blocks', () => {
            const messages: Message[] = [{
                role: 'assistant',
                content: 'Let me search',
                tool_calls: [{
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'search_web', arguments: '{"q": "Anthropic"}' }
                }]
            }];

            const result = adapter.formatMessages(messages, {});

            expect(result[0].role).toBe('assistant');
            expect(result[0].content).toHaveLength(2);
            expect(result[0].content[0].type).toBe('text');
            expect(result[0].content[1].type).toBe('tool_use');
            expect(result[0].content[1].name).toBe('search_web');
            expect(result[0].content[1].input).toEqual({ q: 'Anthropic' });
        });
    });

    describe('buildPayload', () => {
        it('应该正确提取并剥离最后的 【system】 标记到顶层 system 字段', () => {
            // 模拟实际业务中可能出现的系统与用户提示词拼接结构
            const formattedMessages = [{
                role: 'user',
                content: '【system】Please act as a tutor\n【user】Can you explain math?'
            }];
            const data = { version: 'claude-3', llm_params: {} } as ChatRequestData;

            const result = adapter.buildPayload(data, formattedMessages);

            // 提取出的 system 应该不包含前缀
            expect(result.system).toBe('Please act as a tutor');

            // 剩余的 content 应该保留下一个块的标签（因为原代码的正向先行断言不会消耗 '【'）
            expect(formattedMessages[0].content).toBe('【user】Can you explain math?');

            expect(result.max_tokens).toBe(4096); // 验证默认 max_tokens
        });
    });

    describe('buildHeaders', () => {
        it('应该使用 x-api-key 且包含默认版本号', () => {
            const data = { api_key: 'sk-ant-123' } as ChatRequestData;
            const headers = adapter.buildHeaders(data);

            expect(headers['x-api-key']).toBe('sk-ant-123');
            expect(headers['anthropic-version']).toBe('2023-06-01');
            expect(headers['Authorization']).toBeUndefined(); // 确保不走 Bearer
        });
    });

    describe('parseStreamChunk & parseResponse', () => {
        it('parseStreamChunk 应该正确解析 tool_use 增量', () => {
            const startChunk = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'calc' } };
            const startResult = adapter.parseStreamChunk(startChunk);
            expect(startResult.tool_calls?.[0].id).toBe('tu_1');

            const deltaChunk = { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } };
            const deltaResult = adapter.parseStreamChunk(deltaChunk);
            expect(deltaResult.tool_calls?.[0].function?.arguments).toBe('{"a":');
        });

        it('parseResponse 应该提取完整的 tool_calls 和 finish_reason', () => {
            const respJson = {
                content: [
                    { type: 'text', text: 'Result:' },
                    { type: 'tool_use', id: 'tu_2', name: 'get_time', input: { tz: 'UTC' } }
                ],
                usage: { input_tokens: 10, output_tokens: 5 }
            };

            const result = adapter.parseResponse(respJson);

            expect(result.content).toBe('Result:');
            expect(result.tool_calls?.[0].id).toBe('tu_2');
            expect(result.tool_calls?.[0].function.arguments).toBe('{"tz":"UTC"}');
            expect(result.finish_reason).toBe('tool_calls'); // 被标准化
            expect(result.tokens).toBe(15);
        });
    });

    describe('truncatedResponse (Async Continuation)', () => {
        it('应当就地修改 array 并移除 tools 以补全 JSON', async () => {
            // 准备 Mock 环境
            const mockBody = { messages: [{ role: 'user', content: 'test' }] };
            const mockHeaders = { 'anthropic-version': '2023-06-01' };
            const mockWindow = { webContents: { send: jest.fn() } };
            const mockChatManager = { chat: { group_id: '1', tokens: 10 } };
            const mockData = { api_url: 'https://api.anthropic.com', output: '' } as ChatRequestData;

            const mockMessageOutput = {
                content: '',
                tool_calls: [{ function: { arguments: '{"q": "hello' } }] // 缺一半
            };

            // Mock fetch 续写返回
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({
                    content: [{ type: 'text', text: ' world"}' }], // 补齐剩余的 text
                    stop_reason: 'end_turn',
                    usage: { output_tokens: 5 }
                })
            });

            await adapter.truncatedResponse(
                mockBody, mockHeaders, mockWindow, mockChatManager, mockMessageOutput, mockData
            );

            // 断言
            const fetchCallBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
            // 确保 tools 被移除
            expect(fetchCallBody.tools).toBeUndefined();
            // 确保把截断的文本传给了 assistant 进行预填充(Prefill)
            expect(fetchCallBody.messages[1].role).toBe('assistant');
            expect(fetchCallBody.messages[1].content).toBe('{"q": "hello');

            // 确保完整结果被合并写入原对象
            expect(mockMessageOutput.tool_calls[0].function.arguments).toBe('{"q": "hello world"}');
        });
    });
});