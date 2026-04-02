import { LLMService } from './LLMService';
import { ReActAgent } from './ReActAgent';
import { Plugins } from './Plugins';
import { ToolCallAdapterFactory } from '../factories/AdapterFactory';
import { utils, CONSTANTS } from '../utils/globals';
import { Message, ToolInfo } from '../types';
import { logger } from '../utils/logger';

/**
 * LLMAssistant - LLM对话辅助功能类
 * 统一管理压缩对话、设置聊天名称、工具审计等LLM交互功能
 */
export class LLMAssistant {
    private llm_service: LLMService;
    private plugins: Plugins | null;

    constructor(llm_service: LLMService, plugins: Plugins | null = null) {
        this.llm_service = llm_service;
        this.plugins = plugins;
    }

    /**
     * 设置关联的 LLMService 实例
     */
    public setLLMService(llm_service: LLMService): void {
        this.llm_service = llm_service;
    }

    /**
     * 设置关联的 Plugins 实例
     */
    public setPlugins(plugins: Plugins): void {
        this.plugins = plugins;
    }

    // ==================== 对话压缩功能 ====================

    /**
     * 压缩指定群组的消息
     * @param group_id 要压缩的消息群组ID
     * @returns 压缩后的内容，如果失败返回null
     */
    public async compressionGroupMessage({ group_id }: { group_id: string }): Promise<string | null> {
        try {
            const will_compress_messages = this.llm_service.chatManager.getMessages().filter(m => m.group_id === group_id);
            if (will_compress_messages.length > 0) {
                const temp_llm_service = new LLMService();
                const react_agent = new ReActAgent(temp_llm_service);

                let combined_content = will_compress_messages.map(msg =>
                    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                ).join("\n\n");

                const prompt = `You are an intelligent assistant skilled at compressing and summarizing contextual content into detailed documents. Please ensure the generated documents are comprehensive and clear, accurately reflecting the original content.`;
                const query = `# context\n\`\`\`text\n${combined_content}\n\`\`\`\nPlease compress the above context into a detailed document. \nRequirements: use concise language while retaining all essential information.\nplease generate the compressed document:`;

                const data = react_agent.getDataDefault({
                    prompt, query, params: { ...utils.getConfig("llm_params"), temperature: 0.3 }
                });

                let messageOutput = await react_agent.llmCall(data);
                if (messageOutput) {
                    let content = "The user compressed the execution process of the current task. The compressed document is as follows:\n\n---\n\n" + (messageOutput.content as string).trim();

                    const firstMsg = will_compress_messages[0];
                    const preservedUser = will_compress_messages.find(m => m.role === 'user');

                    const compressed_message: Message = {
                        ...firstMsg,
                        content: content,
                        role: "assistant",
                        react: false,
                        context_id: preservedUser?.context_id ?? firstMsg.context_id
                    };

                    let allMessages = this.llm_service.chatManager.getMessages(true);
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

                    if (keptUser) {
                        const insertPos = newMessages.findIndex(m => m.group_id === group_id && m.role === 'user');
                        newMessages.splice(insertPos + 1, 0, compressed_message);
                    } else {
                        const insertPos = originalFirstIndex === -1 ? newMessages.length : originalFirstIndex;
                        newMessages.splice(insertPos, 0, compressed_message);
                    }

                    this.llm_service.chatManager.messages = newMessages;
                    logger.log(`Compression success for id: ${group_id}`);
                    return compressed_message.content as string;
                }
            }
        } catch (error: any) {
            logger.log(`Compression failed for id: ${group_id}, Error: ${error}`);
        }
        return null;
    }

    // ==================== 聊天命名功能 ====================

    /**
     * 根据对话内容生成聊天名称
     * @param _data 可选参数，包含language, model, version等配置
     */
    public async setChatName(_data: any = {}): Promise<void> {
        if (_data?.is_plugin) {
            this.llm_service.chatManager.chat.name = utils.formatDate();
            return;
        }

        const temp_llm_service = new LLMService();
        temp_llm_service.chatManager.chat.tool_format = this.llm_service.chatManager.chat.tool_format;
        const react_agent = new ReActAgent(temp_llm_service);

        // 1. 构建上下文
        const user_content = this.llm_service.chatManager.messages.find(m => m?.role === "user")?.content || "";
        const history_content = this.llm_service.chatManager.messages
            .filter(m => m?.role === "assistant")
            .map(m => utils.parseJsonContent(m.content as string)?.content || "")
            .join("===");

        const prompt = `You are an intelligent assistant skilled at generating short chat names based on contextual content.`;
        const query = `# history\n\`\`\`text\n# user\n${user_content}\n\n# assistant\n${history_content}\n\`\`\`\n\nGenerate a short ${_data?.language || utils.getLanguage()} chat name based on context...`;

        // 2. 发起请求
        const callData = react_agent.getDataDefault({
            prompt,
            query,
            model: _data.model,
            version: _data.version,
        });

        const messageOutput = await react_agent.llmCall(callData);

        if (messageOutput) {
            // 3. 使用适配器处理响应
            const format = this.llm_service.chatManager.chat.tool_format;
            const adapter = ToolCallAdapterFactory.getAdapter(format);

            const rawContent = adapter.extractText(messageOutput);
            const chatName = rawContent.split("\n")[0].trim();

            // 4. 设置结果
            this.llm_service.chatManager.chat.name = chatName || utils.formatDate();
        }
    }

    // ==================== 工具审计功能 ====================

    /**
     * 检查工具是否需要审计
     * @param toolName 工具名称
     */
    public isToolRequireAudit(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.require_audit === true;
    }

    /**
     * 获取工具配置
     * @param toolName 工具名称
     */
    public getToolConfig(toolName: string): any {
        if (!this.plugins) {
            return null;
        }
        const tool = this.plugins.getTool(toolName);
        if (tool && typeof tool === 'object') {
            return tool;
        }
        return null;
    }

    /**
     * AI 审查者逻辑 (LLM-as-a-Judge)
     * 对敏感工具调用进行数据完整性审查
     * @param toolInfo 工具信息
     * @param assistantMessage 助手消息
     * @param data 额外数据
     * @returns 审查结果，如果通过返回null，如果拦截返回错误信息
     */
    public async auditToolCall(toolInfo: ToolInfo, data: Record<string, any>): Promise<string | null> {
        // 1. 基础检查
        if (!toolInfo.tool_call_name || !this.isToolRequireAudit(toolInfo.tool_call_name)) {
            return null;
        }

        if (!utils.getConfig("tool_call")?.llm_judge) {
            return null;
        }

        logger.log(`[Critic] 正在审查敏感工具调用: ${toolInfo.tool_call_name} (ID: ${toolInfo.tool_call_id})...`);

        const temp_llm_service = new LLMService();
        temp_llm_service.chatManager.chat = { ...this.llm_service.chatManager.chat };

        const allMessages = [...this.llm_service.chatManager.getMessages(true)];
        const lastAssistantIdx = allMessages.map(m => m.role).lastIndexOf('assistant');

        if (lastAssistantIdx === -1) {
            logger.warn("[Critic] 未找到对应的助手消息，跳过审计");
            return null;
        }

        const slicedMessages = allMessages.slice(0, lastAssistantIdx + 1);
        const targetMessage = slicedMessages[slicedMessages.length - 1];
        const originalContent = targetMessage.content;

        targetMessage.content = `[LOGGED ASSISTANT THOUGHT]: ${toolInfo.content || originalContent}\nSYSTEM: Execution paused for data integrity audit.`;
        if(targetMessage.role === "assistant") delete targetMessage.tool_calls;

        temp_llm_service.chatManager.messages = slicedMessages;

        const critic_agent = new ReActAgent(temp_llm_service);

        // 3. 构造注入了 ToolInfo 的审查 Prompt
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

# OBJECTIVE:
Determine if the payload contains "Hallucinated/Fake Data" (Blocked) or "Functional Code/Queries" (Allowed).

# CRITERIA:
- ALLOWED: Scripts/SQL/API calls that use placeholders or fetch real-time data.
- BLOCKED: Hardcoded factual data (sequences, coordinates, constants) that should have been retrieved but were instead invented by the LLM.

# OUTPUT FORMAT (JSON ONLY):
{
  "pass": boolean,
  "reason": "Required if pass is false"
}
        `.trim();

        // 4. 执行审计请求
        const callData = critic_agent.getDataDefault({
            ...data,
            query: criticQuery,
            push_message: true,
            output_format: null
        });

        try {
            if (!callData.params) callData.params = {};
            callData.params.llm_params = {
                ...callData.params.llm_params,
                temperature: 0.3, // 审计需要极高的确定性
            };

            const messageOutput = await critic_agent.llmCall(callData);

            if (messageOutput?.content) {
                const resultStr = messageOutput.content as string;
                const jsonMatch = resultStr.match(/\{[\s\S]*\}/);

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

    /**
     * 检查控制台输出是否需要中断指令
     * @param consoleOutput 控制台输出内容
     * @param executionTimeMs 执行时间（毫秒）
     * @returns 检查结果，包含是否中断以及中断理由
     */
    public async checkConsoleOutput(
        consoleOutput: string,
        executionTimeMs: number = 0
    ): Promise<{ shouldInterrupt: boolean; reason: string | null }> {
        try {
            // 创建临时 LLM 服务，复制聊天上下文以利用 kv_cache
            const temp_llm_service = new LLMService();
            temp_llm_service.chatManager.chat = { ...this.llm_service.chatManager.chat };

            const allMessages = [...this.llm_service.chatManager.getMessages(true)];
            const lastAssistantIdx = allMessages.map(m => m.role).lastIndexOf('assistant');

            if (lastAssistantIdx === -1) {
                logger.warn("[Critic] 未找到对应的助手消息，跳过检查");
                return { shouldInterrupt: false, reason: null };
            }

            const slicedMessages = allMessages.slice(0, lastAssistantIdx + 1);
            const targetMessage = slicedMessages[slicedMessages.length - 1];
            const toolMessages = allMessages.slice(lastAssistantIdx + 1, allMessages.length);
            const originalContent = targetMessage.content;

            targetMessage.content = `[LOGGED ASSISTANT CONTENT]: ${originalContent}
            ${targetMessage.role === "assistant" && targetMessage.tool_calls ? `[LOGGED ASSISTANT TOOL_CALLS]: ${JSON.stringify(targetMessage.tool_calls)}` : ''}
            ${toolMessages.map((toolMessage, i) => `[LOGGED TOOL_RESULT ${i}: ${toolMessage.content}`).join("\n")}
            SYSTEM: Execution paused for data integrity audit.`;
            if (targetMessage.role === "assistant") delete targetMessage.tool_calls;

            temp_llm_service.chatManager.messages = slicedMessages;

            const react_agent = new ReActAgent(temp_llm_service);

            // 格式化执行时间
            const formatDuration = (ms: number): string => {
                if (ms < 60000) return `${Math.round(ms / 1000)} 秒`;
                if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟`;
                return `${(ms / 3600000).toFixed(1)} 小时`;
            };

            const executionDuration = formatDuration(executionTimeMs);

            const query = `
[SYSTEM OVERRIDE: CONSOLE OUTPUT MONITORING PROTOCOL]
You are a strict security and safety monitor. Your role is to analyze console output and determine if the ongoing command should be interrupted.

# EXECUTION CONTEXT:
- Execution Time: ${executionDuration}
- History Context: See above conversation history

# CURRENT CONSOLE OUTPUT TO ANALYZE:
\`\`\`text
${consoleOutput}
\`\`\`

# INTERRUPTION CRITERIA:

* INTERRUPT (shouldInterrupt: true) if:
  - Detection of malicious activities (file deletion attempts, system compromise commands)
  - Detection of unauthorized access attempts
  - Detection of commands that may cause data loss or corruption
  - Detection of suspicious network connections or transfers
  - User explicitly requested interruption in the output
  - Commands that appear to be attempting privilege escalation
  - Detection of potentially dangerous operations that could harm the system
  - Execution time is abnormally long and the output suggests the command is stuck in an infinite loop or waiting indefinitely

* CONTINUE (shouldInterrupt: false) if:
  - Normal command execution output
  - Expected results from legitimate operations
  - Informational messages
  - Error messages from failed but non-critical operations
  - Progress indicators or status updates
  - Long-running but legitimate operations (e.g., large file transfers, compilation)

# OUTPUT FORMAT:
You MUST respond ONLY with a valid JSON object. DO NOT call any tools.
{
  "shouldInterrupt": boolean,
  "reason": "Provide a specific reason explaining why the command should be interrupted or why it is safe to continue, regardless of the shouldInterrupt value."
}
`.trim();

            const callData = react_agent.getDataDefault({
                query,
                params: { ...utils.getConfig("llm_params"), temperature: 0.1 },
                push_message: true,
                output_format: null
            });

            if (!callData.params) callData.params = {};
            callData.params.llm_params = {
                ...callData.params.llm_params,
                tool_choice: "none",
                response_format: { type: "json_object" }
            };

            const messageOutput = await react_agent.llmCall(callData);

            if (messageOutput && messageOutput.content) {
                const resultStr = messageOutput.content as string;
                const jsonMatch = resultStr.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    const verdict = JSON.parse(jsonMatch[0]);
                    logger.log(`[ConsoleMonitor] Interrupt check: shouldInterrupt=${verdict.shouldInterrupt}, reason=${verdict.reason}`);
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
}

export default LLMAssistant;
