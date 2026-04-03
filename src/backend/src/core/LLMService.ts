import { ChatManager } from './ChatManager';
import { logger } from '../utils/logger';

import { LLMAdapterFactory } from '../factories/AdapterFactory';
import { ILLMAdapter } from '../adapters/IAdapter';
import { AssistantMessage, ChatRequestData, Message, MessageContent, UserMessage } from '../types';
import { streamJSON, streamSse } from '../utils/stream';
import { formatString } from '../utils/format'; // 原型扩展 format 的替代品
import { BrowserWindow } from 'electron';

export class LLMService {
    private window: BrowserWindow | null;
    public chatManager: ChatManager;
    public stopFlag: boolean = false;
    public adapter: ILLMAdapter;

    constructor(messages: Message[] = [], window: BrowserWindow | null = null) {
        this.window = window;
        this.chatManager = new ChatManager(messages);
        this.adapter = LLMAdapterFactory.getAdapter("openai"); // 默认 API 适配器
    }

    public stopLoop() {
        this.stopFlag = true;
    }

    public startLoop() {
        this.stopFlag = false;
    }

    public async chatBase(data: ChatRequestData): Promise<Message | null> {
        try {
            // 1. 根据 api_type 获取 API 通信适配器
            this.adapter = LLMAdapterFactory.getAdapter(data.api_type);

            // 2. 输入数据清洗与格式化
            let content: string | MessageContent[];
            if (data?.img_url) {
                content = [
                    { type: "text", text: data.input },
                    { type: "image_url", image_url: { url: data.img_url } }
                ];
            } else {
                content = data.input;
            }

            // 3. 构建消息上下文记录
            let messagesList: Message[] = [];
            if (data.system_prompt) {
                messagesList.push({ role: "system", content: data.system_prompt, show: true, react: false });
            }

            messagesList = messagesList.concat(this.chatManager.getMemory());

            const messageInput: UserMessage = { role: "user", content: content, group_id: this.chatManager.chat.group_id, show: true, react: false };
            if (data?.llm_conversation_mode) {
                messagesList.push(messageInput);
            }

            let messageOutput: AssistantMessage = { role: 'assistant', content: '', group_id: this.chatManager.chat.group_id, show: true, react: false };

            // 4. 构建 HTTP 发送载荷
            const formattedMessages = this.adapter.formatMessages(messagesList, data);
            const body = this.adapter.buildPayload(data, formattedMessages);
            const headers = this.adapter.buildHeaders(data);

            if (this.stopFlag) {
                return null;
            }

            // 5. 发起请求
            const resp = await fetch(new URL(data.api_url), {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
            });

            // 6. 流式与非流式分流处理
            let status: boolean;
            if (resp.ok) {
                if (body?.stream) {
                    status = await this.handleStream(resp, this.adapter, data, messageOutput);
                } else {
                    status = await this.handleNormal(resp, this.adapter, headers, body, data, messageOutput);
                }
                if (!status) {
                    return null;
                }
            } else {
                const errorText = await resp.text();
                logger.error(`HTTP Error ${resp.status}: ${errorText}`);
                this.window?.webContents.send('infoData', {
                    ...this.chatManager.chat,
                    content: `Response error: ${errorText}\n`
                });
                return null;
            }


            if (this.stopFlag) {
                return null;
            }

            // 7. 处理并序列化 Tool Calls
            data.output = messageOutput.content;

            if (data.end) {
                if (!data?.llm_conversation_mode) return messageOutput; // 只需返回

                const finalResponseText = data.output_template ? formatString(data.output_template, { ...data }) : data.output;

                this.window?.webContents.send('streamData', {
                    ...this.chatManager.chat,
                    content_reasoning: messageOutput.reasoning_content,
                    content: data.react ? `\n\n${finalResponseText}` : "",
                    end: true
                });
            }

            return messageOutput;

        } catch (error: any) {
            logger.error(error);
            this.window?.webContents.send('infoData', {
                ...this.chatManager.chat,
                content: `Response error: ${error.message}\n`
            });
            return null;
        }
    }

    private async handleStream(resp: Response, adapter: any, data: ChatRequestData, messageOutput: AssistantMessage): Promise<boolean> {
        const contentType = resp.headers.get('content-type');
        let streamRes;

        if (contentType && contentType.includes('text/event-stream')) {
            streamRes = streamSse(resp);
        } else {
            streamRes = streamJSON(resp);
        }

        for await (const chunk of streamRes) {
            if (this.stopFlag) return false;

            const { content, reasoning_content, tool_calls, tokens, is_incremental_tokens } = adapter.parseStreamChunk(chunk);

            // 组装文本内容
            if (content) {
                messageOutput.content += content;
            }

            // 组装 reasoning_content
            if (reasoning_content) {
                messageOutput.reasoning_content = (messageOutput.reasoning_content || "") + reasoning_content;
            }

            // 组装并拼凑碎片的 Tool Calls (统一处理 OpenAI 和 Anthropic 格式)
            if (tool_calls) {
                if (!messageOutput.tool_calls) messageOutput.tool_calls = [];
                for (const tc of tool_calls) {
                    if (tc.index !== undefined) {
                        // OpenAI 格式
                        if (!messageOutput.tool_calls[tc.index]) {
                            messageOutput.tool_calls[tc.index] = {
                                id: tc.id,
                                type: "function",
                                function: { name: tc.function?.name || "", arguments: "" }
                            };
                        }
                        const currentToolCall = messageOutput.tool_calls[tc.index];
                        if (tc.function?.arguments && currentToolCall?.function) {
                            currentToolCall.function.arguments += tc.function.arguments;
                        }
                    } else {
                        // Anthropic 格式或其他直接返回的格式
                        messageOutput.tool_calls.push(tc);
                    }
                }
            }

            // 更新 token
            if (tokens) { if (is_incremental_tokens) { this.chatManager.chat.tokens = (this.chatManager.chat.tokens || 0) + tokens; } else { this.chatManager.chat.tokens = tokens; } }

            // IPC 向前台推流
            if (!data?.react && data?.llm_conversation_mode) {
                this.window?.webContents.send('streamData', {
                    ...this.chatManager.chat,
                    content: content,
                    reasoning_content: reasoning_content
                });
            }
        }

        return true;
    }

    private async handleNormal(resp: Response, adapter: ILLMAdapter, headers: any, body: any, data: ChatRequestData, messageOutput: AssistantMessage): Promise<boolean> {
        let respJson: any;
        try {
            respJson = await resp.json()
        } catch (error: any) {
            console.error(error);
            this.window?.webContents.send('infoData', {
                ...this.chatManager.chat,
                content: `Response error: ${error.message}\n`
            });
            return false;
        }

        const { content, reasoning_content, tool_calls, finish_reason, tokens } = adapter.parseResponse(respJson);

        data.output = content;
        messageOutput.content = content;
        if (reasoning_content) messageOutput.reasoning_content = reasoning_content;
        if (tool_calls) {
            messageOutput.tool_calls = tool_calls;
        }

        if (tokens) this.chatManager.chat.tokens = tokens;

        if (!data?.react && data?.llm_conversation_mode) {
            this.window?.webContents.send('streamData', { ...this.chatManager.chat, content: `\n\n${data.output}`, reasoning_content: reasoning_content });
        }

        // ========== 截断检测与自动续传机制 (Max: 3) ==========
        if (finish_reason === "length" && data.output) {
            await adapter.truncatedResponse(body, headers, this.window, this.chatManager, messageOutput, data);
        }

        return true;
    }
}