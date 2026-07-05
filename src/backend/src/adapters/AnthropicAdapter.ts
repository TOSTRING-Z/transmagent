import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult, OpenAITool, ToolInfo, AssistantMessage, MessageContent } from '../types';
import JSON5 from 'json5';
import { parse } from 'partial-json';

export class AnthropicAdapter implements ILLMAdapter {
    public formatMessages(messages: Message[], data: ChatRequestData): any[] {
        const formattedMessages = messages
            .filter(message => message.role !== 'system')
            .map((message) => {
                const isAssistant = message.role === 'assistant';
                const messageCopy: any = {
                    role: (message.role === 'tool' || message.role === 'user') ? 'user' : 'assistant',
                    content: []
                };

                // 1. 工具结果处理 (优先且独立)
                if (message.role === 'tool' && message.tool_call_id) {
                    messageCopy.content = [{
                        type: 'tool_result',
                        tool_use_id: message.tool_call_id,
                        content: typeof message.content === 'string'
                            ? message.content
                            : JSON.stringify(message.content)
                    }];
                    return messageCopy;
                }

                // 2. 标准化 content 为数组
                let contentArray: any[] = Array.isArray(message.content) 
                    ? [...message.content] 
                    : [{ type: 'text', text: message.content || '' }];

                if (isAssistant) {
                    contentArray.unshift({
                        type: 'thinking',
                        thinking: (message as any).reasoning_content || '',
                        signature: (message as any)?.thinking_signature || ''
                    });

                    // 3b. 处理 Tool Calls
                    const toolUses = (message.tool_calls || []).map((tc: any) => {
                        let args = {};
                        if (tc.function?.arguments) {
                            try {
                                args = typeof tc.function.arguments === 'string'
                                    ? JSON.parse(tc.function.arguments)
                                    : tc.function.arguments;
                            } catch (e) { }
                        }
                        return {
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function?.name || tc.name,
                            input: args
                        };
                    });

                    // 3c. 组装 Assistant 消息
                    const allowedTypes = data.params?.vision
                        ? ['text', 'image', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking']
                        : ['text', 'thinking', 'redacted_thinking'];

                    messageCopy.content = contentArray
                        .filter(c => allowedTypes.includes(c.type))
                        .concat(toolUses);

                } else {
                    // 4. 处理 User 消息
                    if (data.params?.vision) {
                        messageCopy.content = contentArray
                            .map((c: any) => {
                                if (c.type === 'image_url' && c.image_url?.url) {
                                    // 放宽正则限制以支持带参数的 Base64
                                    const match = c.image_url.url.match(/^data:(image\/[^;]+);(?:[^,]+,)?base64,(.+)$/);
                                    if (match) {
                                        return {
                                            type: 'image',
                                            source: { type: 'base64', media_type: match[1], data: match[2] }
                                        };
                                    }
                                }
                                return c;
                            })
                            .filter(c => ['text', 'image'].includes(c.type));
                    } else {
                        const textContent = contentArray
                            .filter(c => c.type === 'text')
                            .map(c => c.text)
                            .join('\n');
                        messageCopy.content = [{ type: 'text', text: textContent }];
                    }
                }

                return messageCopy;
            });

        // 5. 合并连续同角色消息 (Anthropic API 限制)
        const mergedMessages: any[] = [];
        for (const msg of formattedMessages) {
            const prev = mergedMessages[mergedMessages.length - 1];
            if (prev && prev.role === msg.role) {
                prev.content = [...prev.content, ...msg.content];
            } else {
                mergedMessages.push(msg);
            }
        }

        // 6. 追加环境变量和 Todo 列表
        const extraTexts: string[] = [data.env_message, data.todolist_message].filter(Boolean) as string[];
        if (extraTexts.length > 0) {
            const extraContent = { type: 'text', text: extraTexts.join('\n') };
            const last = mergedMessages[mergedMessages.length - 1];

            if (last && last.role === 'user') {
                last.content.push(extraContent);
            } else {
                mergedMessages.push({ role: 'user', content: [extraContent] });
            }
        }

        return mergedMessages;
    }

    public buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any> {
        const body: Record<string, any> = {
            model: data.version,
            messages: formattedMessages,
            max_tokens: data.llm_params?.max_tokens || 4096,
            ...data.llm_params
        };

        // 提取 System Prompt
        let systemMessages = data.system_prompt || ""; // 默认取第一个消息的文本作为 system prompt，后续可以根据实际情况调整提取逻辑

        // 兼容原有的 【system】 标记逻辑
        const lastMessage = formattedMessages[formattedMessages.length - 1];
        if (lastMessage?.role === "user" && typeof lastMessage.content === "string") {
            const systemMatch = lastMessage.content.match(/^【system】(.*?)(?=【|$)/s);
            if (systemMatch) {
                systemMessages = (systemMessages ? systemMessages + '\n' : '') + systemMatch[1].trim();
                lastMessage.content = lastMessage.content.replace(/^【system】.*?(?=【|$)/s, '').trim();
            }
        }

        if (systemMessages) {
            body.system = systemMessages; // Anthropic 顶级 system 参数
        }

        // 将 OpenAI 格式转换为 Anthropic 格式
        if (data.tools && data.tools.length > 0) {
            body.tools = data.tools.map(tool => {
                const func = tool.function || tool;

                return {
                    name: func.name,
                    description: func.description,
                    input_schema: func.parameters // OpenAI 的 parameters 即为 Anthropic 的 input_schema
                };
            });
        }

        if (body.stream) {
            body.stream = true;
        }

        return body;
    }

    public buildHeaders(data: ChatRequestData): Record<string, string> {
        const headers: Record<string, string> = {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01"  // 或使用最新的版本
        };

        if (data?.api_key) {
            // Anthropic使用 x-api-key 头，而不是 Authorization Bearer
            headers["x-api-key"] = data.api_key;
        }

        // 可选：添加anthropic-beta头（如果需要测试beta功能）
        // headers["anthropic-beta"] = "tools-2024-04-04";

        return headers;
    }

    public parseStreamChunk(chunk: any): StreamChunkResult {
        let content = "";
        let reasoning_content = "";
        let thinking_signature: string | undefined = undefined;
        let tool_calls: any[] | undefined = undefined;
        let tokens: number = 0;
        let is_incremental_tokens: boolean | undefined;
        let finish_reason: string | undefined = undefined;

        if (chunk.type === "content_block_start") {
            // 工具调用开始
            if (chunk.content_block?.type === "tool_use") {
                tool_calls = [{
                    index: chunk.index,
                    id: chunk.content_block.id,
                    type: "function",
                    function: { name: chunk.content_block.name, arguments: "" }
                }];
            }
        } else if (chunk.type === "content_block_delta") {
            if (chunk.delta?.type === "text_delta") {
                content = chunk.delta.text;
            } else if (chunk.delta?.type === "thinking_delta") {
                // thinking 内容流式下发
                reasoning_content = chunk.delta.thinking || chunk.delta.thought || "";
            } else if (chunk.delta?.type === "signature_delta") {
                // signature 通过独立的 signature_delta 事件下发（Anthropic / DeepSeek v4）
                thinking_signature = chunk.delta.signature;
            } else if (chunk.delta?.type === "input_json_delta") {
                // 工具调用的参数流式下发
                tool_calls = [{
                    index: chunk.index,
                    function: { arguments: chunk.delta.partial_json }
                }];
            }
        } else if (chunk.type === "message_delta") {
            // Anthropic 的截断原因在 message_delta 中
            if (chunk.delta?.stop_reason) {
                finish_reason = chunk.delta.stop_reason;
            }
            if (chunk.usage?.input_tokens) {
                is_incremental_tokens = true;
                tokens += chunk.usage.input_tokens;
            }
            if (chunk.usage?.output_tokens) {
                is_incremental_tokens = true;
                tokens = chunk.usage.output_tokens;
            }
            if (chunk.usage?.cache_creation_input_tokens) {
                is_incremental_tokens = false;
                tokens += chunk.usage.cache_creation_input_tokens;
            }
            if (chunk.usage?.cache_read_input_tokens) {
                is_incremental_tokens = false;
                tokens += chunk.usage.cache_read_input_tokens;
            }
        } else if (chunk.type === "message_stop") {
            // message_stop 前可能携带最终 stop_reason
            if (chunk.stop_reason) {
                finish_reason = chunk.stop_reason;
            }
        } else if (chunk.type === "message_start" && chunk.message?.usage) {
            is_incremental_tokens = false;
            const usage = chunk.message.usage;
            tokens = (usage?.cache_creation_input_tokens || usage?.cache_read_input_tokens) + usage.input_tokens;
        }

        return { content, reasoning_content, thinking_signature, tool_calls, tokens, is_incremental_tokens, finish_reason };
    }

    public parseResponse(respJson: any): any {
        let content = "";
        let reasoning_content = "";
        let thinking_signature: string | undefined = undefined;
        let tool_calls: any[] | undefined = undefined;
        let finish_reason = "";
        let tokens: number | undefined = undefined;

        if (respJson.content && respJson.content.length > 0) {
            // 提取 text 内容
            content = respJson.content
                .filter((block: any) => block.type === "text")
                .map((block: any) => block.text)
                .join('');

            // 提取 thinking 内容 (MiniMax M2 模型)
            const thinkingBlocks = respJson.content
                .filter((block: any) => block.type === "thinking")
                .map((block: any) => block.thinking || block.thought || '')
                .join('');
            if (thinkingBlocks) {
                reasoning_content = thinkingBlocks;
            }

            // 提取 thinking 块的 signature（用于后续重建 thinking 块）
            const firstThinkingBlock = respJson.content.find(
                (block: any) => block.type === 'thinking'
            );
            if (firstThinkingBlock?.signature) {
                thinking_signature = firstThinkingBlock.signature;
            }
        }

        const toolUseBlocks = respJson.content?.filter((block: any) => block.type === "tool_use");
        if (toolUseBlocks && toolUseBlocks.length > 0) {
            tool_calls = toolUseBlocks.map((block: any) => ({
                id: block.id,
                type: "function",
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input) // 保持 OpenAI 规范的 String 格式
                }
            }));
            finish_reason = "tool_calls"; // 修正为 standard 的 tool_calls
        } else {
            finish_reason = respJson.stop_reason || "stop"; // 修正为 standard 格式
        }

        if (respJson.usage) {
            tokens = (respJson.usage.cache_read_input_tokens || 0) + (respJson.usage.input_tokens || 0) + (respJson.usage.output_tokens || 0);
        }

        // 保存原始 content 数组，用于 formatMessages 直接透传（无需重建 thinking 块）
        const raw_content = respJson.content || undefined;
        return { content, reasoning_content, thinking_signature, raw_content, tool_calls, finish_reason, tokens };
    }

    public async truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData) {
        let continuationCount = 0;
        const maxContinuations = 3;

        let isToolCallTruncated = messageOutput.tool_calls && messageOutput.tool_calls.length > 0;

        // 1. 如果是 Tool Call 截断，直接放弃续写，利用 parse 尽力修复半截 JSON
        if (isToolCallTruncated) {
            let partialContent = messageOutput.tool_calls[0].function.arguments || "";
            try {
                // 依赖外部引入的 partial-json 或 best-effort-json-parser
                partialContent = JSON.stringify(parse(partialContent));
            } catch (error) {
                console.warn("[Anthropic] Failed to parse truncated tool call JSON", error);
            }
            messageOutput.tool_calls[0].function.arguments = partialContent;

            // 修复完毕直接返回，不走后续的请求逻辑
            return;
        }

        // 2. 如果是普通文本截断，保留原本的 Anthropic Prefill 续写逻辑
        let partialContent = data.output;
        let continuationMessages = [...body.messages, { role: "assistant", content: partialContent }];

        while (continuationCount < maxContinuations) {
            continuationCount++;
            const continuationBody = { ...body, messages: continuationMessages };

            try {
                const contResp = await fetch(new URL(data.api_url), {
                    method: "POST",
                    headers: {
                        ...headers,
                        "anthropic-version": headers["anthropic-version"] || "2023-06-01"
                    },
                    body: JSON.stringify(continuationBody)
                });
                const contRespJson = await contResp.json() as any;

                if (contRespJson.error) {
                    console.error("[Anthropic Continuation Error]", contRespJson.error);
                    break;
                }

                const parsedCont = this.parseResponse(contRespJson);
                const newContent = parsedCont.content || "";

                partialContent += newContent;
                data.output = partialContent;
                messageOutput.content = data.output;

                if (!data?.react && data?.llm_conversation_mode) {
                    window?.webContents.send('streamData', {
                        group_id: chatManager.chat.group_id,
                        content: newContent,
                        end: false,
                        chat: chatManager.chat
                    });
                }

                if (parsedCont.tokens) chatManager.chat.tokens = parsedCont.tokens;

                const isTruncated = parsedCont.finish_reason === "max_tokens" || parsedCont.finish_reason === "length";
                if (!isTruncated) {
                    console.log(`[Anthropic Continuation] Completed after ${continuationCount} continuation(s)`);
                    break;
                }

                // 严格要求：不能 push 新的 assistant 对象，直接修改内容
                continuationMessages[continuationMessages.length - 1].content = partialContent;

            } catch (error: any) {
                console.error("[Anthropic Continuation Error]", error);
                break;
            }
        }
    }

    public getConversationalURL(baseUrl: string): string {
        return `${baseUrl}/v1/messages`;
    }
}

export class AnthropicToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any {
        return toolSchemas.map(schema => {
            if (schema.type === "raw_string") return null;
            return {
                type: "custom",
                name: schema.name,
                description: schema.description || '',
                input_schema: schema.parameters || {
                    type: 'object',
                    properties: {}
                }
            };
        }).filter(Boolean);
    }
    public getToolInfos(message: AssistantMessage): ToolInfo[] {
        let toolInfos: ToolInfo[] = [];
        const reasoningContent = message.reasoning_content || "";
        const textContent = message.content as string || "";

        if (message?.tool_calls && message.tool_calls.length > 0) {
            for (let call of message.tool_calls) {
                try {
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: textContent,
                        tool_call_name: call?.function?.name ?? null,
                        tool_call_id: call?.id ?? null,
                        params: call?.function?.arguments ? JSON5.parse(call.function.arguments as string) : {},
                        error: null
                    });
                } catch (error: any) {
                    let observation = `Arguments are not a pure JSON text, or there is a problem with the JSON format: ${error.message}`;
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: textContent,
                        tool_call_name: call?.function?.name ?? null,
                        tool_call_id: call?.id ?? null,
                        params: call?.function?.arguments,
                        error: observation
                    });
                }
            }
        } else {
            toolInfos.push({ reasoning_content: reasoningContent, content: textContent, tool_call_name: null, tool_call_id: null, params: {}, error: null });
        }
        return toolInfos;
    }
    extractText(message: any): string {
        const content = message.content;
        if (Array.isArray(content)) {
            const textItem = content.find((c: any) => c.type === "text");
            return textItem ? textItem.text : "";
        }
        return typeof content === 'string' ? content : "";
    }
}