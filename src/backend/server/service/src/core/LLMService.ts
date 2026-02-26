import { ChatManager } from './ChatManager';
import { AdapterFactory } from '../factories/AdapterFactory';
import { ChatRequestData, Message } from '../types';
import { streamJSON, streamSse } from '../utils/stream';
import { formatString } from '../utils/format'; // 原型扩展 format 的替代品

export class LLMService {
    private window: any;
    public chatManager: ChatManager;
    public stopFlag: boolean = false;

    constructor(messages: Message[] = [], window: any = null) {
        this.window = window;
        this.chatManager = new ChatManager(messages);
    }

    public stopMessage() {
        this.stopFlag = true;
    }

    public startMessage() {
        this.stopFlag = false;
    }

    public async chatBase(data: ChatRequestData): Promise<string | null> {
        try {
            // 1. 获取对应数据结构适配器
            const adapter = AdapterFactory.getAdapter(data.tool_format);

            // 2. 输入数据清洗与格式化
            let content: any = data.input;
            if (data.tool_format === "prompt" && typeof content !== "string") {
                content = JSON.stringify(content);
            }
            if (data?.img_url) {
                content = [
                    { "type": "text", "text": data.input },
                    { "type": "image_url", "image_url": { "url": data.img_url } }
                ];
            }

            // 3. 构建消息上下文记录
            let messagesList: Message[] = [];
            if (data.system_prompt) {
                messagesList.push({ role: "system", content: data.system_prompt, id: data.id, show: true, react: false });
            }
            messagesList = messagesList.concat(this.chatManager.getMemory(data.memory_length || 10));

            const messageInput: Message = { role: "user", content: content, id: data.id, show: true, react: false };
            if (data?.push_message) {
                messagesList.push(messageInput);
            }
            if (data?.env_message) {
                messagesList.push(data.env_message);
            }

            const messageOutput: Message = { role: 'assistant', content: '', id: data.id, show: true, react: false };

            // 4. 构建 HTTP 发送载荷
            const formattedMessages = adapter.formatMessages(messagesList, data.params);
            const body = adapter.buildPayload(data, formattedMessages);

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (data?.api_key) headers["Authorization"] = `Bearer ${data.api_key}`;

            if (this.stopFlag) {
                this.stopFlag = false;
                return "The user interrupted the task.";
            }

            // 5. 发起请求
            const resp = await fetch(new URL(data.api_url), {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body),
            });

            // 6. 流式与非流式分流处理
            if (body?.stream) {
                await this.handleStream(resp, adapter, data, messageOutput);
            } else {
                await this.handleNormal(resp, adapter, headers, body, data, messageOutput);
            }

            if (this.stopFlag) {
                return "The user interrupted the task.";
            }

            // 7. 处理并序列化 Tool Calls
            data.output = messageOutput.content as string;
            if (data.tool_format === "openai" && messageOutput.tool_calls && messageOutput.tool_calls.length > 0) {
                data.output = JSON.stringify({
                    content: data.output,
                    tool_calls: messageOutput.tool_calls
                });
            }

            // 8. 存入本地记忆与结束反馈
            if (data.end) {
                if (data?.push_message) {
                    this.chatManager.pushMessage(messageInput);
                    this.chatManager.pushMessage(messageOutput);
                }

                if (data?.return_response) return data.output; // 只需返回

                const finalResponseText = data.output_template ? formatString(data.output_template, { ...data }) : data.output;
                
                this.window?.webContents.send('stream-data', { 
                    id: data.id, 
                    content: data.react ? finalResponseText : "", 
                    end: true, 
                    chat: this.chatManager.chat 
                });
                
                return data.output;
            } else {
                if (data?.push_message) {
                    this.chatManager.pushMessage(messageInput);
                    this.chatManager.pushMessage(messageOutput);
                }
            }

            return data.output;

        } catch (error: any) {
            console.error(error);
            if (!data?.return_response) {
                this.window?.webContents.send('info-data', {
                    id: data.id,
                    content: `Response error: ${error.message}\n`
                });
            }
            return null;
        }
    }

    private async handleStream(resp: Response, adapter: any, data: ChatRequestData, messageOutput: Message) {
        const contentType = resp.headers.get('content-type');
        let streamRes;
        
        if (contentType && contentType.includes('text/event-stream')) {
            streamRes = streamSse(resp);
        } else {
            streamRes = streamJSON(resp);
        }

        for await (const chunk of streamRes) {
            if (this.stopFlag) return;

            const { content, reasoning_content, tool_calls, tokens } = adapter.parseStreamChunk(chunk);
            
            // 组装文本
            let textDelta = content || reasoning_content || "";
            if (textDelta) {
                messageOutput.content += textDelta;
            }

            // 组装并拼凑碎片的 Tool Calls
            if (data.tool_format === "openai" && tool_calls) {
                if (!messageOutput.tool_calls) messageOutput.tool_calls = [];
                for (let tc of tool_calls) {
                    if (tc.index !== undefined) {
                        if (!messageOutput.tool_calls[tc.index]) {
                            messageOutput.tool_calls[tc.index] = { 
                                id: tc.id, 
                                type: "function", 
                                function: { name: tc.function?.name || "", arguments: "" } 
                            };
                        }
                        if (tc.function?.name) messageOutput.tool_calls[tc.index].function.name += tc.function.name;
                        if (tc.function?.arguments) messageOutput.tool_calls[tc.index].function.arguments += tc.function.arguments;
                    }
                }
            }

            // 更新 token
            if (tokens) {
                this.chatManager.chat.tokens = tokens;
            }

            // IPC 向前台推流
            if (!data?.react && !data?.return_response) {
                this.window?.webContents.send('stream-data', { 
                    id: data.id, 
                    content: textDelta, 
                    end: false, 
                    chat: this.chatManager.chat 
                });
            }
        }
    }

    private async handleNormal(resp: Response, adapter: any, headers: any, body: any, data: ChatRequestData, messageOutput: Message) {
        let respJson: any;
        try {
            respJson = await resp.json();
        } catch (err) {
            console.error(await resp.text());
            return;
        }

        if (respJson.error && !data?.return_response) {
            this.window?.webContents.send('info-data', {
                id: data.id, 
                content: `POST Error:\n\`\`\`\n${respJson.error.message}\n\`\`\`\n`
            });
            return;
        }

        const { content, tool_calls, finish_reason, tokens } = adapter.parseResponse(respJson);
        
        data.output = content;
        messageOutput.content = content;
        if (tool_calls) messageOutput.tool_calls = tool_calls;
        
        if (tokens) this.chatManager.chat.tokens = tokens;

        if (!data?.react && !data?.return_response) {
            this.window?.webContents.send('stream-data', { id: data.id, content: data.output, end: false, chat: this.chatManager.chat });
        }

        // ========== 截断检测与自动续传机制 (Max: 3) ==========
        if (finish_reason === "length" && data.output) {
            console.log("[LLM Service] Output truncated, starting continuation...");
            let continuationCount = 0;
            const maxContinuations = 3;
            let continuationMessages = [...body.messages, { role: "assistant", content: data.output }];

            while (continuationCount < maxContinuations) {
                continuationCount++;
                const continuationBody = { ...body, messages: continuationMessages };

                try {
                    const contResp = await fetch(new URL(data.api_url), {
                        method: "POST", headers, body: JSON.stringify(continuationBody)
                    });
                    const contRespJson = await contResp.json() as any;

                    if (contRespJson.error) {
                        console.error("[Continuation Error]", contRespJson.error);
                        break;
                    }

                    const parsedCont = adapter.parseResponse(contRespJson);
                    data.output += parsedCont.content;
                    messageOutput.content = data.output; // 全量积累

                    if (!data?.react && !data?.return_response) {
                        this.window?.webContents.send('stream-data', { 
                            id: data.id, content: parsedCont.content, end: false, chat: this.chatManager.chat 
                        });
                    }

                    if (parsedCont.tokens) this.chatManager.chat.tokens = parsedCont.tokens;

                    if (parsedCont.finish_reason !== "length") {
                        console.log(`[Continuation] Completed after ${continuationCount} continuation(s)`);
                        break;
                    }

                    continuationMessages.push({ role: "assistant", content: parsedCont.content });

                } catch (error) {
                    console.error("[Continuation Error]", error);
                    break;
                }
            }
        }
    }
}