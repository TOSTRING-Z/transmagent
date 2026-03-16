import { ILLMAdapter, IToolCallAdapter } from './IAdapter';
import { ChatRequestData, Message, MessageContent, OllamaContent, OpenAIContent, StreamChunkResult, ImageContent, TextContent, ToolInfo } from '../types';
import JSON5 from 'json5';
import { logger } from '../utils/logger';

export class OpenAIAdapter implements ILLMAdapter {
    public formatMessages(messages: Message[], params: any, env_message?: any): any[] {
        let formattedMessages = messages.map((message) => {
            // 1. 深度拷贝并剔除本地状态字段
            const messageCopy: OpenAIContent = {
                role: message.role,
                content: message.content
            }
            if (message.role === "tool" && message.tool_call_id) {
                messageCopy.tool_call_id = message.tool_call_id;
                if (typeof messageCopy.content !== 'string') {
                    messageCopy.content = JSON.stringify(messageCopy.content);
                }
            }
            if (message.role === "assistant" && message.tool_calls) {
                messageCopy.tool_calls = message.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    type: "function",
                    function: {
                        name: tc.function?.name || tc.name,
                        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
                    }
                }));
            }

            // 2. 视觉模型参数处理
            if (!params?.vision) {
                // 非视觉模型：如果是数组内容，提取出纯文本
                if (Array.isArray(messageCopy.content)) {
                    messageCopy.content = messageCopy.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n');
                }
            } else {
                // 视觉模型：根据支持的媒体类型进行过滤
                if (Array.isArray(messageCopy.content)) {
                    messageCopy.content = messageCopy.content.filter((c: any) => {
                        switch (c.type) {
                            case "image_url":
                                return params.vision.includes("image");
                            case "video_url":
                                return params.vision.includes("video");
                            case "text":
                                return true;
                            default:
                                return false;
                        }
                    });
                }
            }

            // 3. 针对 Ollama 等兼容 OpenAI 格式的模型做特殊适配
            if (params?.ollama && Array.isArray(messageCopy.content)) {
                try {
                    const textObj = messageCopy.content.find(
                        (c: MessageContent): c is TextContent => c.type === "text"
                    );
                    const imgObj = messageCopy.content.find(
                        (c: MessageContent): c is ImageContent => c.type === "image_url"
                    );
                    if (textObj && imgObj) {
                        const base64Image = imgObj.image_url.url.split(",")[1];
                        const role = messageCopy.role === "tool" ? "user" : messageCopy.role; // tool角色转换为user
                        let ollamaContent: OllamaContent = {
                            role: role,
                            content: textObj.text || "",
                            images: [base64Image]
                        };
                        return ollamaContent;
                    }
                } catch (e: any) {
                    console.error("Ollama format error", e);
                }
            }

            return messageCopy;
        });

        if (env_message) {
            formattedMessages[formattedMessages.length - 1].content += `\n${env_message.content}`;
        }
        return formattedMessages;
    }

    public buildPayload(data: ChatRequestData, formattedMessages: any[]): Record<string, any> {
        const body: Record<string, any> = {
            model: data.version,
            messages: formattedMessages,
            ...data.llm_params
        };

        // 处理 OpenAI 规范的 Function Calling
        if (data.tools && data.tools.length > 0) {
            body.tools = data.tools;
            body.tool_choice = "auto";
        }

        // 默认启用 Usage 统计 (Claude 不支持此参数，原逻辑做了排除)
        if (body.stream && !body.stream_options && data.version && !data.version.includes("claude")) {
            body.stream_options = { include_usage: true };
        }

        return body;
    }

    public buildHeaders(data: ChatRequestData): Record<string, string> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (data?.api_key) headers["Authorization"] = `Bearer ${data.api_key}`;
        return headers;
    }

    public parseStreamChunk(chunk: any): StreamChunkResult {
        let content = "";
        let reasoning_content = "";
        let tool_calls: any[] | undefined = undefined;
        let tokens: number | undefined = undefined;

        if (chunk.message?.content) {
            content = chunk.message.content;
        } else {
            const delta = chunk.choices?.[0]?.delta;
            if (delta) {
                if (delta.reasoning_content) {
                    reasoning_content = delta.reasoning_content;
                } else if (delta.content) {
                    content = delta.content;
                }
                if (delta.tool_calls) {
                    tool_calls = delta.tool_calls;
                }
            }
        }

        // 兼容不同的 token 统计返回格式
        if (chunk.usage?.total_tokens) {
            tokens = chunk.usage.total_tokens;
        } else if (chunk.prompt_eval_count !== undefined) {
            tokens = chunk.prompt_eval_count + (chunk.eval_count || 0);
        }

        return { content, reasoning_content, tool_calls, tokens };
    }

    public parseResponse(respJson: any): any {
        let content = "";
        let tool_calls: any[] | undefined = undefined;
        let finish_reason = "";

        if (respJson.message) {
            content = respJson.message.content;
        } else {
            const choice = respJson.choices?.[0];
            content = choice?.message?.content || "";
            tool_calls = choice?.message?.tool_calls;
            finish_reason = choice?.finish_reason || "";
        }

        return {
            content,
            tool_calls,
            finish_reason,
            tokens: respJson.usage?.total_tokens
        };
    }

    public async truncatedResponse(body: any, headers: any, window: any, chatManager: any, messageOutput: any, data: ChatRequestData) {
        let continuationCount = 0;
        const maxContinuations = 3;

        let isToolCallTruncated = messageOutput.tool_calls && messageOutput.tool_calls.length > 0;
        let partialContent = isToolCallTruncated
            ? messageOutput.tool_calls[0].function.arguments || ""
            : data.output;

        // 【修改点 1】保持原始对话历史不变，续写的 Prompt 每次循环动态生成
        let baseMessages = [...body.messages];

        while (continuationCount < maxContinuations) {
            continuationCount++;

            // 【修改点 2】采用“镜像回放”策略的极强 Prompt，明确告知上下文
            let currentPrompt = "";
            if (isToolCallTruncated) {
                currentPrompt = `You were generating JSON arguments for a tool call, but the output was truncated due to length limits.\n\nHere is the exact JSON string you have generated so far:\n\`\`\`\n${partialContent}\n\`\`\`\n\nYour task is to output ONLY the missing remaining suffix to complete the JSON.\n- DO NOT output the prefix that is already generated above.\n- DO NOT wrap your output in markdown code blocks (no \`\`\`json).\n- DO NOT explain or apologize.\n- Start typing exactly what comes next. Ensure all open strings, arrays, and objects are properly closed so the final combined result is a valid JSON.`;
            } else {
                currentPrompt = `Your previous response was truncated due to length limits.\n\nHere is what you have output so far:\n${partialContent}\n\nPlease output ONLY the exact continuation. Do not repeat what is already generated above.`;
            }

            const continuationMessages = [
                ...baseMessages,
                { role: "user", content: currentPrompt }
            ];

            const continuationBody = { ...body, messages: continuationMessages };

            if (isToolCallTruncated) {
                delete continuationBody.tools;
                if (continuationBody.tool_choice) delete continuationBody.tool_choice;
            }

            try {
                const contResp = await fetch(new URL(data.api_url), {
                    method: "POST", headers, body: JSON.stringify(continuationBody)
                });
                const contRespJson = await contResp.json() as any;

                if (contRespJson.error) {
                    console.error("[OpenAI Continuation Error]", contRespJson.error);
                    break;
                }

                const parsedCont = this.parseResponse(contRespJson);
                let newContent = parsedCont.content || "";

                // 【修改点 3】防呆设计：过滤 Markdown 标记，并处理模型“擅自重写整个 JSON”的情况
                if (isToolCallTruncated) {
                    newContent = newContent.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');

                    // 如果模型没有听话（输出了以 { 开头的完整内容），我们尝试解析它
                    if (newContent.trim().startsWith("{") && newContent.length > 10) {
                        try {
                            JSON.parse(newContent);
                            // 如果能成功解析，说明它完整重新生成了整个 JSON！直接替换，不需要拼接了
                            partialContent = newContent;
                            messageOutput.tool_calls[0].function.arguments = partialContent;
                            break;
                        } catch (e) {
                            // 解析失败，说明它可能只输出了部分，继续按拼接处理
                        }
                    }
                }

                // 拼接内容
                partialContent += newContent;

                if (isToolCallTruncated) {
                    messageOutput.tool_calls[0].function.arguments = partialContent;
                } else {
                    data.output = partialContent;
                    messageOutput.content = data.output;
                }

                if (!data?.react && !data?.return_response) {
                    window?.webContents.send('streamData', {
                        group_id: chatManager.chat.group_id,
                        content: newContent,
                        end: false,
                        chat: chatManager.chat,
                        is_tool_call_args: isToolCallTruncated
                    });
                }

                if (parsedCont.tokens) chatManager.chat.tokens = parsedCont.tokens;

                // 如果不是因为长度截断，说明大模型认为自己补全完毕了，跳出循环
                if (parsedCont.finish_reason !== "length") {
                    console.log(`[OpenAI Continuation] Completed after ${continuationCount} continuation(s)`);
                    break;
                }

            } catch (error: any) {
                console.error("[OpenAI Continuation Error]", error);
                break;
            }
        }

        // 【修改点 4】终极兜底：循环结束后，如果 JSON 依然缺括号，自动闭合
        if (isToolCallTruncated) {
            partialContent = this.autoCloseJson(partialContent);
            messageOutput.tool_calls[0].function.arguments = partialContent;
        }
    }

    /**
     * 辅助方法：简单粗暴的 JSON 自动闭合（兜底机制）
     * 用于修复模型在补全最后忘记输出 `}` 的情况
     */
    private autoCloseJson(jsonStr: string): string {
        let fixed = jsonStr.trim();
        try {
            JSON.parse(fixed);
            return fixed; // 已经是合法的 JSON，直接返回
        } catch (e) {
            // 如果最后一个字符是转义符，去掉它防止报错
            if (fixed.endsWith('\\')) fixed = fixed.slice(0, -1);

            // 检查双引号是否成对，不成对则补一个双引号闭合字符串
            if ((fixed.match(/"/g) || []).length % 2 !== 0) {
                fixed += '"';
            }

            // 尝试常见的闭合后缀
            const endings = ['}', ']}', '}]}', '"}', '"]}', '}"}'];
            for (const ending of endings) {
                try {
                    JSON.parse(fixed + ending);
                    return fixed + ending; // 解析成功，返回修复后的字符串
                } catch (err) {
                    continue;
                }
            }
            return jsonStr; // 彻底修复失败，原样返回（交由业务层的 catch 处理）
        }
    }
}

export class OpenAIToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any {
        return toolSchemas.map(schema => {
            if (schema.type === "raw_string") return null;
            return { type: "function", function: schema };
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
        return typeof message.content === 'string' ? message.content : "";
    }
}