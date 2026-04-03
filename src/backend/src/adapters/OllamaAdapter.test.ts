import { OllamaAdapter, OllamaToolCallAdapter } from './OllamaAdapter';
import { ChatRequestData, Message } from '../types';

describe('OllamaAdapter Unit Tests (API Communication)', () => {
    let adapter: OllamaAdapter;
    let data: ChatRequestData;

    beforeEach(() => {
        adapter = new OllamaAdapter();
        data = {
            id: "string",
            input: "string",
            api_type: "ollama",
            api_url: "http://localhost:11434/api/chat",
            version: "llama3.2-vision",
            params: { vision: ['image'] },
            todolist_message: "string",
            env_message: 'Current time is 10 AM'
        }
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('formatMessages', () => {
        it('应该将 tool 角色转换为 user', () => {
            const messages: any[] = [{ role: 'tool', content: 'result' }];
            const result = adapter.formatMessages(messages, data);

            expect(result[0].role).toBe('user');
            expect(result[0].content).toBe('result');
        });

        it('针对视觉模型且存在图文混合时，应该正确提取 base64 并生成 OllamaContent', () => {
            const messages: Message[] = [{
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe this' },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo...' } }
                ]
            }];

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
        it('应该构建 Ollama 特定的 Payload', () => {
            const data: Partial<ChatRequestData> = {
                version: 'llama3.2',
                llm_params: { temperature: 0.7, top_p: 0.9 },
                tools: [{ type: 'function', function: { name: 'test' } }] as any
            };
            const messages: Message[] = [{ role: 'user', content: 'Hi' }];

            const result = adapter.buildPayload(data as ChatRequestData, messages);

            expect(result.model).toBe('llama3.2');
            expect(result.stream).toBe(true);
            expect(result.temperature).toBe(0.7);
            expect(result.top_p).toBe(0.9);
            expect(result.tools).toBeUndefined(); // Ollama 不支持 tools 参数
        });

        it('应该处理 chat_template_kwargs', () => {
            const data: Partial<ChatRequestData> = {
                version: 'qwen3',
                llm_params: { 
                    chat_template_kwargs: { 
                        enable_thinking: false 
                    } 
                }
            };
            const messages: Message[] = [{ role: 'user', content: 'Hi' }];

            const result = adapter.buildPayload(data as ChatRequestData, messages);

            expect(result.options).toBeDefined();
            expect(result.options.enable_thinking).toBe(false);
        });
    });

    describe('buildHeaders', () => {
        it('应该返回简单的 Content-Type header', () => {
            const result = adapter.buildHeaders(data);

            expect(result['Content-Type']).toBe('application/json');
            expect(result['Authorization']).toBeUndefined(); // Ollama 不需要 API key
        });
    });

    describe('parseStreamChunk', () => {
        it('应该解析 Ollama 流式响应的 message.content', () => {
            const chunk = {
                message: { content: 'Hello world' },
                prompt_eval_count: 10,
                eval_count: 5
            };

            const result = adapter.parseStreamChunk(chunk);

            expect(result.content).toBe('Hello world');
            expect(result.tokens).toBe(15);
        });

        it('应该解析 reasoning/thinking', () => {
            const chunk = {
                message: { content: 'Thinking...', reasoning: 'Let me think about this' }
            };

            const result = adapter.parseStreamChunk(chunk);

            expect(result.reasoning_content).toBe('Let me think about this');
        });
    });

    describe('parseResponse', () => {
        it('应该解析 Ollama 完整响应', () => {
            const respJson = {
                message: { content: 'Final answer', reasoning: 'My reasoning' },
                done: true,
                done_reason: 'stop',
                prompt_eval_count: 10,
                eval_count: 5
            };

            const result = adapter.parseResponse(respJson);

            expect(result.content).toBe('Final answer');
            expect(result.reasoning_content).toBe('My reasoning');
            expect(result.finish_reason).toBe('stop');
            expect(result.tokens).toBe(15);
        });

        it('应该识别 context_length_exceeded', () => {
            const respJson = {
                message: { content: '...' },
                done: true,
                done_reason: 'context_length_exceeded'
            };

            const result = adapter.parseResponse(respJson);

            expect(result.finish_reason).toBe('length');
        });
    });
});

describe('OllamaToolCallAdapter Unit Tests', () => {
    let adapter: OllamaToolCallAdapter;

    beforeEach(() => {
        adapter = new OllamaToolCallAdapter();
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
            expect(result['search']).toContain('query: (Required)');
        });
    });

    describe('getToolInfos', () => {
        it('应该从 JSON 内容中提取工具调用信息', () => {
            const message: Message = {
                role: 'assistant',
                content: JSON.stringify({ tool: 'search', params: { query: 'test' }, id: 'call_1' })
            };

            const result = adapter.getToolInfos(message);

            expect(result.length).toBe(1);
            expect(result[0].tool_call_name).toBe('search');
            expect(result[0].params).toEqual({ query: 'test' });
            expect(result[0].tool_call_id).toBe('call_1');
        });

        it('应该处理纯文本（无工具调用）', () => {
            const message: Message = {
                role: 'assistant',
                content: 'This is just a regular response without any tool calls.'
            };

            const result = adapter.getToolInfos(message);

            expect(result.length).toBe(1);
            expect(result[0].tool_call_name).toBeNull();
            expect(result[0].content).toBe('This is just a regular response without any tool calls.');
        });

        it('应该处理 thinking 标签', () => {
            const message: Message = {
                role: 'assistant',
                content: '<thinking>I need to search for this</thinking>\n{"tool": "search", "params": {"query": "test"}}'
            };

            const result = adapter.getToolInfos(message);

            expect(result[0].reasoning_content).toBe('I need to search for this');
        });
    });
});
