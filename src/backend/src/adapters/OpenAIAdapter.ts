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

        // 获取截断的 ToolCall 参数。如果没有 tool_calls，则回退到普通文本续写
        let isToolCallTruncated = messageOutput.tool_calls && messageOutput.tool_calls.length > 0;
        let partialContent = isToolCallTruncated
            ? messageOutput.tool_calls[0].function.arguments || ""
            : data.output;

        // 【修改点 1】针对 Tool Call 和普通文本，使用不同的高强度 Prompt
        const continuationPrompt = isToolCallTruncated
            ? "The previous response was truncated while generating JSON arguments for a tool call. Please continue and complete the remaining valid JSON string. OUTPUT STRICTLY THE REMAINING RAW JSON TEXT ONLY. Do NOT output markdown code blocks (e.g., ```json), do NOT output tool-calling keywords or function names, and do NOT repeat the previous content. Start exactly from where the text was cut off."
            : "The response was truncated due to output length limits. Please continue and complete the remaining content exactly where you left off. Only output the completion, do not repeat previous content.";

        // 将已有的截断内容作为普通文本传入 assistant 角色中，触发补全
        let continuationMessages = [
            ...body.messages,
            { role: "assistant", content: partialContent },
            { role: "user", content: continuationPrompt }
        ];

        while (continuationCount < maxContinuations) {
            continuationCount++;
            const continuationBody = { ...body, messages: continuationMessages };

            // 移除 tools 和 tool_choice，强制大模型输出纯文本来补全剩下的 JSON
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

                // 【可选的安全网】如果模型依然顽固地输出了 ```json 这样的 markdown 标记，这里强行剔除
                if (isToolCallTruncated) {
                    newContent = newContent.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
                }

                // 根据截断类型，将续写的新文本拼接到正确的位置
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

                if (parsedCont.finish_reason !== "length") {
                    console.log(`[OpenAI Continuation] Completed after ${continuationCount} continuation(s)`);
                    break;
                }

                // 【修改点 2】修复 Bug：更新倒数第二条消息（assistant），而不是最后一条（user）
                continuationMessages[continuationMessages.length - 2].content = partialContent;

            } catch (error: any) {
                console.error("[OpenAI Continuation Error]", error);
                break;
            }
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