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

    /**
     * 创建临时 ReActAgent 实例用于独立LLM调用
     */
    private createTempAgent(temp_llm_service?: LLMService): ReActAgent {
        if (!temp_llm_service) {
            temp_llm_service = new LLMService();
        }
        return new ReActAgent(temp_llm_service);
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
            .map(m => utils.parseJsonContent(m.content as string)?.thinking || "")
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
     * 检查工具是否为高风险工具
     * @param toolName 工具名称
     */
    public isHighRiskTool(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.high_risk === true;
    }

    /**
     * 检查工具是否为敏感工具
     * @param toolName 工具名称
     */
    public isSensitiveTool(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.sensitive_tool === true;
    }

    /**
     * 检查工具是否需要审计
     * @param toolName 工具名称
     */
    public isToolRequireAudit(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.require_audit === true;
    }

    /**
     * 检查工具审计是否启用
     * @param toolName 工具名称
     */
    public isToolAuditEnabled(toolName: string): boolean {
        const toolConfig = this.getToolConfig(toolName);
        return toolConfig?.audit_enabled === true;
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
    public async auditToolCall(toolInfo: ToolInfo, assistantMessage: Message, data: Record<string, any>): Promise<string | null> {
        // 1. 检查工具是否为敏感工具且需要审计
        if (!toolInfo.tool || !this.isSensitiveTool(toolInfo.tool) || !this.isToolRequireAudit(toolInfo.tool)) {
            return null;
        }

        // 2. 检查审计是否启用
        if (!this.isToolAuditEnabled(toolInfo.tool)) {
            logger.log(`[Critic] 工具 ${toolInfo.tool} 审计已禁用，跳过审查`);
            return null;
        }

        // 3. 检查LLM审查器是否启用
        if (!utils.getConfig("tool_call")?.llm_judge) {
            return null;
        }

        logger.log(`[Critic] 正在审查敏感工具调用: ${toolInfo.tool} (ID: ${toolInfo.id})...`);

        const temp_llm_service = new LLMService();
        temp_llm_service.chatManager.chat = { ...this.llm_service.chatManager.chat };

        // 构建隔离的助手消息，剔除并发的其他工具
        const isolatedAssistantMessage: Message = { ...assistantMessage };
        const isNativeToolCall = isolatedAssistantMessage.tool_calls && isolatedAssistantMessage.tool_calls.length > 0;

        if (isNativeToolCall) {
            // [原生 API 模式] 只保留当前正在审查的这一个 tool_call
            isolatedAssistantMessage.tool_calls = isolatedAssistantMessage.tool_calls!.filter(
                call => call.id === toolInfo.id
            );

            // 容错：如果没匹配上，直接赋一个单元素数组
            if (isolatedAssistantMessage.tool_calls.length === 0) {
                isolatedAssistantMessage.tool_calls = [{
                    id: toolInfo.id || "dummy_id",
                    type: "function",
                    function: {
                        name: toolInfo.tool,
                        arguments: JSON.stringify(toolInfo.params)
                    }
                }];
            }
        } else {
            // [Prompt 模式] 重构 content，确保审查者只看到当前的单一工具负载
            const isolatedPayload = {
                thinking: toolInfo.thinking,
                tool: toolInfo.tool,
                params: toolInfo.params
            };
            isolatedAssistantMessage.content = JSON.stringify(isolatedPayload, null, 2);
        }

        // 组装审查上下文
        temp_llm_service.chatManager.messages = [
            ...this.llm_service.chatManager.getMessages(true),
            isolatedAssistantMessage
        ];

        // 闭环假消息：针对原生 API 补充单一的工具回复
        if (isNativeToolCall) {
            temp_llm_service.chatManager.messages.push({
                role: "tool",
                content: "SYSTEM: Execution paused. Proceed to internal audit.",
                tool_call_id: toolInfo.id || "dummy_id",
                tool_call_name: toolInfo.tool,
                group_id: assistantMessage.group_id,
                context_id: assistantMessage.context_id
            });
        }

        const critic_agent = new ReActAgent(temp_llm_service);

        // 审查查询
        const criticQuery = `
[SYSTEM OVERRIDE: INTERNAL AUDIT PROTOCOL]
You must now pause your current task and act as a strict Data Integrity Critic. 
Review the tool call payload you just generated above.

# OBJECTIVE:
Distinguish between "Developing Tools/Scripts" (Allowed) and "Hallucinating Final Data" (Blocked).

# CRITICAL CHECK CRITERIA:

* ALLOWED (Pass = true): 
  - Writing scripts to query APIs, scrape websites, or parse local files.
  - Using placeholders for credentials (e.g., 'YOUR_API_KEY', 'TEMP_TOKEN').
  - Creating boilerplate code or skeleton functions intended to be executed for real data retrieval.
  - Mocking structure for testing logic flow, UNLESS it replaces a factual data source.

* BLOCKED (Pass = false): 
  - Hardcoding factual/scientific results (e.g., specific protein sequences, GPS coordinates, experimental values) instead of writing code to fetch them.
  - Using random number generators (e.g., \`random.random()\`) to simulate analytical results.
  - Providing a "mock response" script that prints hardcoded fake data to bypass an actual API/Tool requirement.

# OUTPUT FORMAT:
You MUST respond ONLY with a valid JSON object. DO NOT call any tools.
{
  "pass": boolean,
  "reason": "If false, state EXACTLY which specific data point was mocked and how it should be correctly fetched."
}
        `.trim();

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
                temperature: 0.1,
                tool_choice: "none",
                response_format: { type: "json_object" }
            };

            const messageOutput = await critic_agent.llmCall(callData);

            if (messageOutput && messageOutput.content) {
                const resultStr = messageOutput.content as string;
                const jsonMatch = resultStr.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    const verdict = JSON.parse(jsonMatch[0]);
                    if (verdict.pass === false) {
                        logger.log(`[Critic] 拦截成功! 发现伪造数据: ${verdict.reason}`);
                        return `[CRITIC REJECTION] Execution Blocked. Your payload violates data integrity rules:\nReason: ${verdict.reason}`;
                    }
                }
            }
        } catch (error) {
            console.error("[Critic] 审查过程发生异常，默认放行:", error);
        }

        return null;
    }
}

export default LLMAssistant;
