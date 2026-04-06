import { LLMService } from './LLMService';
import { ReActAgent } from './ReActAgent';
import { Plugins } from './Plugins';
import { ToolCallAdapterFactory } from '../factories/AdapterFactory';
import { Message, ToolInfo, AssistantMessage } from '../types';
import { logger } from '../utils/logger';
import { Utils } from '../utils/Utils';

/**
 * LLMAssistant - LLM对话辅助功能类
 * 统一管理压缩对话、设置聊天名称、工具审计等LLM交互功能
 */
export class LLMAssistant {
    private llmService: LLMService;
    private plugins: Plugins | null;
    private utils: Utils;

    constructor(llmService: LLMService, plugins: Plugins | null = null, utils: Utils) {
        this.llmService = llmService;
        this.plugins = plugins;
        this.utils = utils;
    }

    public setLLMService(llmService: LLMService): void {
        this.llmService = llmService;
    }

    public setPlugins(plugins: Plugins): void {
        this.plugins = plugins;
    }

    // ==================== 公共助手方法 ====================

    /**
     * 创建临时 ReActAgent
     * 统一处理配置拷贝与消息深拷贝，避免对主对话上下文造成意外污染
     * @param modifyMessages 可选回调，用于对拷贝的消息列表进行修改
     */
    private createTempAgent(modifyMessages?: (messages: Message[]) => void): ReActAgent {
        const temp_llmService = new LLMService(undefined, null, this.utils);
        // 复制聊天配置
        temp_llmService.chatManager.chat = { ...this.llmService.chatManager.chat };

        // 深拷贝消息，规避原代码中修改引用带来的越权污染隐患
        const clonedMessages = this.llmService.chatManager.getMessages(true).map(m => ({ ...m }));

        if (modifyMessages) {
            modifyMessages(clonedMessages);
        }

        temp_llmService.chatManager.messages = clonedMessages;
        return new ReActAgent(temp_llmService, null, this.llmService.utils);
    }

    // ==================== 对话压缩功能 ====================

    public async compressionGroupMessage({ group_id }: { group_id: string }): Promise<string | null> {
        try {
            const will_compress_messages = this.llmService.chatManager.getMessages().filter(m => m.group_id === group_id);
            if (will_compress_messages.length === 0) return null;

            const react_agent = this.createTempAgent();

            const prompt = `You are an intelligent assistant skilled at compressing and summarizing contextual content into detailed documents. Please ensure the generated documents are comprehensive and clear, accurately reflecting the original content.`;
            const query = `Please compress our current context into a detailed document. \nRequirements: use concise language while retaining all essential information.\nplease generate the compressed document:`;

            const data = react_agent.getDataDefault({
                prompt, 
                query, 
                params: { ...this.utils.getConfig("llm_params"), temperature: 0.3 },
                llm_conversation_mode: true
            });

            let messageOutput = await react_agent.llmCall(data);
            if (messageOutput && !this.llmService.stopFlag) {
                let content = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + (messageOutput.content as string).trim();

                const firstMsg = will_compress_messages[0];
                const preservedUser = will_compress_messages.find(m => m.role === 'user');

                const compressed_message: Message = {
                    ...firstMsg,
                    content,
                    role: "assistant",
                    react: false,
                    context_id: preservedUser?.context_id ?? firstMsg.context_id
                };

                let allMessages = this.llmService.chatManager.getMessages(true);
                const originalFirstIndex = allMessages.findIndex(m => m.group_id === group_id);
                const newMessages: Message[] = [];
                let keptUser = false;

                for (const m of allMessages) {
                    if (m.group_id !== group_id) {
                        newMessages.push(m);
                    } else if (!keptUser && m.role === 'user') {
                        newMessages.push(m);
                        keptUser = true;
                    }
                }

                const insertPos = keptUser 
                    ? newMessages.findIndex(m => m.group_id === group_id && m.role === 'user') + 1 
                    : (originalFirstIndex === -1 ? newMessages.length : originalFirstIndex);
                
                newMessages.splice(insertPos, 0, compressed_message);

                this.llmService.chatManager.messages = newMessages;
                logger.log(`Compression success for id: ${group_id}`);
                return compressed_message.content as string;
            }
        } catch (error: any) {
            logger.log(`Compression failed for id: ${group_id}, Error: ${error}`);
        }
        return null;
    }

    // ==================== 聊天命名功能 ====================

    public async setChatName(_data: any = {}): Promise<void> {
        if (_data?.is_plugin) {
            this.llmService.chatManager.chat.name = this.utils.formatDate();
            return;
        }

        const react_agent = this.createTempAgent();

        const prompt = `You are an intelligent assistant skilled at generating short chat names based on contextual content.`;
        const query = `Generate a short ${_data?.language || this.utils.getLanguage()} chat name based on context...`;

        const callData = react_agent.getDataDefault({
            prompt,
            query,
            model: _data.model,
            version: _data.version,
            llm_conversation_mode: true
        });

        const messageOutput = await react_agent.llmCall(callData);

        if (messageOutput && !this.llmService.stopFlag) {
            const format = this.llmService.chatManager.chat.tool_format;
            const adapter = ToolCallAdapterFactory.getAdapter(format);
            const rawContent = adapter.extractText(messageOutput);
            const chatName = rawContent.split("\n")[0].trim();
            this.llmService.chatManager.chat.name = chatName || this.utils.formatDate();
        }
    }

    // ==================== 工具审计功能 ====================

    public isToolRequireAudit(toolName: string): boolean {
        return this.getToolConfig(toolName)?.require_audit === true;
    }

    public getToolConfig(toolName: string): any {
        if (!this.plugins) return null;
        const tool = this.plugins.getTool(toolName);
        return (tool && typeof tool === 'object') ? tool : null;
    }

    public async auditToolCall(toolInfo: ToolInfo, data: Record<string, any>): Promise<string | null> {
        if (!toolInfo.tool_call_name || !this.isToolRequireAudit(toolInfo.tool_call_name) || !this.utils.getConfig("tool_call")?.llm_judge) {
            return null;
        }

        logger.log(`[Critic] 正在审查敏感工具调用: ${toolInfo.tool_call_name} (ID: ${toolInfo.tool_call_id})...`);

        let hasValidContext = true;
        const critic_agent = this.createTempAgent((messages) => {
            const lastAssistantIdx = messages.map(m => m.role).lastIndexOf('assistant');
            if (lastAssistantIdx === -1) {
                hasValidContext = false;
                return;
            }
            messages.splice(lastAssistantIdx + 1);
            
            // 增加显式断言
            const targetMessage = messages[messages.length - 1] as AssistantMessage;
            
            targetMessage.content = `[LOGGED ASSISTANT THOUGHT]: ${toolInfo.content || targetMessage.content}\nSYSTEM: Execution paused for data integrity audit.`;
            delete targetMessage.tool_calls;
        });

        if (!hasValidContext) {
            logger.warn("[Critic] 未找到对应的助手消息，跳过审计");
            return null;
        }

        const payloadString = JSON.stringify(toolInfo.params || {}, null, 2);
        const criticQuery = `
[SYSTEM OVERRIDE: INTERNAL AUDIT PROTOCOL]
You are a strict Data Integrity Critic. Review the following proposed tool call:

# TARGET TOOL
Tool: ${toolInfo.tool_call_name}

# PROPOSED PAYLOAD
\`\`\`json
${payloadString}
\`\`\`

# OBJECTIVE: Determine if the payload contains "Hallucinated/Fake Data" (Blocked) or "Functional Code/Queries" (Allowed).
# OUTPUT FORMAT (JSON ONLY):
{
  "pass": boolean,
  "reason": "Required if pass is false"
}
`.trim();

        const callData = critic_agent.getDataDefault({
            ...data,
            query: criticQuery,
            params: { ...this.utils.getConfig("llm_params"), temperature: 0.3 },
            llm_conversation_mode: true,
            output_format: null
        });

        try {
            const messageOutput = await critic_agent.llmCall(callData);
            if (messageOutput?.content && !this.llmService.stopFlag) {
                const jsonMatch = (messageOutput.content as string).match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const verdict = JSON.parse(jsonMatch[0]);
                    if (verdict.pass === false) {
                        logger.log(`[Critic] 拦截! 理由: ${verdict.reason}`);
                        return `[CRITIC REJECTION] Data Integrity Violation.\nReason: ${verdict.reason}`;
                    }
                }
            }
        } catch (error) {
            console.error("[Critic] 审计异常:", error);
        }

        return null;
    }

    // ==================== 控制台输出检查功能 ====================

    public async checkConsoleOutput(
        consoleOutput: string,
        executionTimeMs: number = 0
    ): Promise<{ shouldInterrupt: boolean; reason: string | null }> {
        try {
            let hasValidContext = true;
            const react_agent = this.createTempAgent((messages) => {
                const lastAssistantIdx = messages.map(m => m.role).lastIndexOf('assistant');
                if (lastAssistantIdx === -1) {
                    hasValidContext = false;
                    return;
                }
                const toolMessages = messages.slice(lastAssistantIdx + 1);
                messages.splice(lastAssistantIdx + 1);
                
                // 增加显式断言
                const targetMessage = messages[messages.length - 1] as AssistantMessage;

                targetMessage.content = `[LOGGED ASSISTANT CONTENT]: ${targetMessage.content}
                ${targetMessage.tool_calls ? `[LOGGED ASSISTANT TOOL_CALLS]: ${JSON.stringify(targetMessage.tool_calls)}` : ''}
                ${toolMessages.map((msg, i) => `[LOGGED TOOL_RESULT ${i}: ${msg.content}`).join("\n")}
                SYSTEM: Execution paused for data integrity audit.`;
                delete targetMessage.tool_calls;
            });

            if (!hasValidContext) {
                return { shouldInterrupt: false, reason: null };
            }

            const formatDuration = (ms: number) => {
                if (ms < 60000) return `${Math.round(ms / 1000)} 秒`;
                if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟`;
                return `${(ms / 3600000).toFixed(1)} 小时`;
            };

            const query = `
[SYSTEM OVERRIDE: CONSOLE OUTPUT MONITORING PROTOCOL]
You are a strict security and safety monitor. Analyze console output and determine if the ongoing command should be interrupted.

# EXECUTION CONTEXT:
- Execution Time: ${formatDuration(executionTimeMs)}
- History Context: See above conversation history

# CURRENT CONSOLE OUTPUT TO ANALYZE:
\`\`\`text
${consoleOutput}
\`\`\`

# OUTPUT FORMAT (JSON ONLY):
{
  "shouldInterrupt": boolean,
  "reason": "Provide a specific reason..."
}
`.trim();

            const callData = react_agent.getDataDefault({
                query,
                params: { 
                    ...this.utils.getConfig("llm_params"), 
                    temperature: 0.1,
                    tool_choice: "none",
                    response_format: { type: "json_object" }
                },
                llm_conversation_mode: true,
                output_format: null
            });

            const messageOutput = await react_agent.llmCall(callData);

            if (messageOutput?.content && !this.llmService.stopFlag) {
                const jsonMatch = (messageOutput.content as string).match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const verdict = JSON.parse(jsonMatch[0]);
                    return {
                        shouldInterrupt: verdict.shouldInterrupt === true,
                        reason: verdict.reason || null
                    };
                }
            }
        } catch (error) {
            logger.warn(`[ConsoleMonitor] Check failed, allowing execution to continue: ${error}`);
        }

        return { shouldInterrupt: false, reason: null };
    }

    // ==================== KV Cache 总结助手功能 ====================

    public async kvCacheSummary() {
        try {
            const react_agent = this.createTempAgent();
            react_agent.llmService.chatManager.fixMessages();

            const query = `[SYSTEM OVERRIDE: KV CACHE SUMMARY PROTOCOL]
You are an intelligent assistant skilled at summarizing conversation history. Your task is to create a concise summary of the key points, decisions, and important information from the conversation history.

Please create a concise summary of the key points, important decisions, and valuable information from our conversation history above. Focus on information that would be useful to retain for future context.`;

            const callData = react_agent.getDataDefault({
                query,
                params: { 
                    ...this.utils.getConfig("llm_params"), 
                    temperature: 0.3,
                    tool_choice: "none"
                },
                llm_conversation_mode: true,
                output_format: null
            });

            const messageOutput = await react_agent.llmCall(callData);

            if (messageOutput?.content && !this.llmService.stopFlag) {
                const summaryContent = (messageOutput.content as string).trim();
                logger.log(`[KVCacheSummary] Summary generated successfully, length=${summaryContent.length}`);
                
                if (summaryContent) {
                    const messages = this.llmService.chatManager.messages;
                    if (messages.length > 0) {
                        const lastMsg = messages[messages.length - 1];
                        lastMsg.content = (lastMsg.content as string) + `\n\n[SESSION SUMMARY]\n${summaryContent}`;
                        logger.log(`[KVCacheSummary] Appended summary to last message`);
                    }
                }
            }
        } catch (error: any) {
            logger.warn(`[KVCacheSummary] Failed: ${error.message}`);
        }
    }
}

export default LLMAssistant;