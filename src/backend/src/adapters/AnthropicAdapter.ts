import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, StreamChunkResult, OpenAITool, ToolInfo, AssistantMessage } from '../types';
import JSON5 from 'json5';
import { parse } from 'partial-json';

export class AnthropicAdapter implements ILLMAdapter {
    public formatMessages(messages: Message[], data: ChatRequestData): any[] {
        let formattedMessages = messages
            .filter(message => message.role !== 'system') // 过滤掉 system 消息
            .map((message) => {
                const messageCopy: any = {
                    // Anthropic 只接受 user 和 assistant
                    role: (message.role === 'tool' || message.role === 'user') ? 'user' : 'assistant',
                    content: message.content
                };

                // 标准化 content 为数组，方便后续处理
                let contentArray: any[] = Array.isArray(message.content)
                    ? [...message.content]
                    : (message.content ? [{ type: 'text', text: message.content }] : []);

                // 2. 工具结果处理 (Tool Result)
                if (message.role === "tool" && message.tool_call_id) {
                    messageCopy.content = [{
                        type: "tool_result",
                        tool_use_id: message.tool_call_id,
                        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
                    }];
                    return messageCopy;
                }

                // 3. Assistant 消息中的工具调用 (Tool Use)
                if (message.role === "assistant" && message.tool_calls) {
                    const toolUses = message.tool_calls.map((tc: any) => {
                        let args = {};
                        if (tc.function?.arguments) {
                            try {
                                args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
                            } catch (e) {
                                args = {};
                            }
                        }
                        return {
                            type: "tool_use",
                            id: tc.id,
                            name: tc.function?.name || tc.name,
                            input: args
                        };
                    });
                    messageCopy.content = [...contentArray.filter(c => c.type === 'text'), ...toolUses];
                    return messageCopy;
                }

                // 4. 视觉模型与普通模型内容过滤转换
                if (data.params?.vision) {
                    messageCopy.content = contentArray.map((c: any) => {
                        if (c.type === "image_url" && c.image_url?.url) {
                            const match = c.image_url.url.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
                            if (match) {
                                return {
                                    type: "image",
                                    source: { type: "base64", media_type: match[1], data: match[2] }
                                };
                            }
                        }
                        return c;
                    }).filter(c => ['text', 'image', 'tool_use', 'tool_result'].includes(c.type));
                } else {
                    // 非视觉模型：如果是数组且不是工具调用相关，提取纯文本并保持数组格式包裹
                    if (message.role !== 'tool' && !(message as AssistantMessage).tool_calls) {
                        const textContent = contentArray
                            .filter((c: any) => c.type === 'text')
                            .map((c: any) => c.text)
                            .join('\n');
                        messageCopy.content = [{ type: 'text', text: textContent }];
                    }
                }

                return messageCopy;
            });

        // 5. 添加环境变量消息
        const lastMessage = formattedMessages[formattedMessages.length - 1];
        if (data.env_message) {
            lastMessage.content.push({ type: 'text', text: data.env_message });
        }
        if (data.todolist_message) {
            lastMessage.content.push({ type: 'text', text: data.todolist_message });
        }

        return formattedMessages;
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
        let tool_calls: any[] | undefined = undefined;
        let tokens: number | undefined = undefined;

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
            } else if (chunk.delta?.type === "input_json_delta") {
                // 工具调用的参数流式下发
                tool_calls = [{
                    index: chunk.index,
                    function: { arguments: chunk.delta.partial_json }
                }];
            }
        } else if (chunk.type === "message_delta" && chunk.usage?.output_tokens) {
            tokens = chunk.usage.output_tokens;
        } else if (chunk.type === "message_start" && chunk.message?.usage) {
            tokens = chunk.message.usage.input_tokens;
        }

        return { content, reasoning_content, tool_calls, tokens, is_incremental_tokens: true };
    }

    public parseResponse(respJson: any): any {
        let content = "";
        let reasoning_content = "";
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

        return { content, reasoning_content, tool_calls, finish_reason, tokens };
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

                if (!data?.react && !data?.return_response) {
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