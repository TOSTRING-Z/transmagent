import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, MessageContent, StreamChunkResult, ToolInfo } from '../types';
import JSON5 from 'json5';

export class AnthropicAdapter implements ILLMAdapter {
    public formatMessages(messages: Message[], params: any, env_message?: any): any[] {
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
                            } catch(e) {
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
                if (params?.vision) {
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
                    if (message.role !== 'tool' && !message.tool_calls) {
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
        if (env_message) {
            // 确保 env_message 也是数组格式
            const envCopy = { ...env_message };
            if (typeof envCopy.content === 'string') {
                envCopy.content = [{ type: 'text', text: envCopy.content }];
            }
            formattedMessages.push(envCopy);
        }

        // 6. 核心修复：合并相邻的同角色消息 (解决连续 user 或连续 assistant 的问题)
        const mergedMessages: any[] = [];
        for (const msg of formattedMessages) {
            const lastMsg = mergedMessages[mergedMessages.length - 1];

            if (lastMsg && lastMsg.role === msg.role) {
                // 角色相同，合并 content (前提是我们前面已经把内容全部统一规范成了数组)
                const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content : [{ type: 'text', text: lastMsg.content || "" }];
                const currentContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content || "" }];

                // 合并数组
                lastMsg.content = [...lastContent, ...currentContent];
            } else {
                // 角色不同，直接放入
                mergedMessages.push(msg);
            }
        }

        // 7. 兜底策略：如果处理完后为了兼容纯文本框架，把纯文本的 content 还原为字符串（可选）
        // Anthropic API 完全支持 content 为对象数组，通常保留数组结构是最安全的。

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

        if (data.tools && data.tools.length > 0) {
            body.tools = data.tools;
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
        let tool_calls: any[] | undefined = undefined;
        let finish_reason = "";
        let tokens: number | undefined = undefined;

        if (respJson.content && respJson.content.length > 0) {
            content = respJson.content
                .filter((block: any) => block.type === "text")
                .map((block: any) => block.text)
                .join('');
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
            tokens = (respJson.usage.input_tokens || 0) + (respJson.usage.output_tokens || 0);
        }

        return { content, tool_calls, finish_reason, tokens };
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
    public getToolInfo(message: Message): ToolInfo {
        let toolInfo: ToolInfo;
        if (message?.tool_calls && message.tool_calls.length > 0) {
            let call = message.tool_calls[0];
            try {
                toolInfo = {
                    thinking: message.content as string,
                    tool: call?.function?.name ?? null,
                    id: call?.id ?? null,
                    params: call?.function?.arguments ? JSON5.parse(call.function.arguments as string) : {},
                    error: null
                };
            } catch (error: any) {
                // 解析失败时的兜底错误处理
                let observation = `Arguments are not a pure JSON text, or there is a problem with the JSON format: ${error.message}`;
                toolInfo = {
                    thinking: message.content as string,
                    tool: call?.function?.name ?? null,
                    id: call?.id ?? null,
                    params: call?.function?.arguments,
                    error: observation
                };
            }
        } else {
            toolInfo = { thinking: message.content as string, tool: null, id: null, params: {}, error: null };
        }
        return toolInfo;
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