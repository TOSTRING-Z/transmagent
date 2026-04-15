import * as fs from 'fs/promises';
import { LLMService } from './LLMService';
import { Mode, ReActAgent } from './ReActAgent';
import { Plugins } from './Plugins';
import { ToolCallAdapterFactory } from '../factories/AdapterFactory';
import { Message, ToolInfo, AssistantMessage } from '../types';
import { logger } from '../utils/logger';
import { Utils } from './Utils';
import { formatDate } from '../utils/public';
import { ToolCall } from './ToolCall';

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
            this.llmService.chatManager.chat.name = formatDate();
            return;
        }

        const react_agent = this.createTempAgent();
        react_agent.llmService.chatManager.fixMessages();

        // 1. 角色定义：强调指令遵循和格式约束
        const prompt = `You are a naming assistant. Your task is to provide a concise chat title based on the conversation context. 
CRITICAL: Output ONLY the plain text of the name. Do not include markdown formatting, quotes, punctuation, or any introductory text.`;

        // 2. 任务指令：加入具体的“不准做”事项
        const query = `Based on the following conversation context, generate a short chat name (maximum 5-7 words) in ${_data?.language || this.utils.getLanguage()}.
STRICT RULES:
- NO quotation marks (e.g., "Name")
- NO markdown formatting (e.g., **Name**)
- NO explanatory text (e.g., "Here is the name:")
- NO prefix or suffix
- Just the raw name text.`;

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
            this.llmService.chatManager.chat.name = chatName || formatDate();
        }
    }

    // ==================== 工具审计功能 ====================

    public isToolRequireAudit(toolName: string, toolCall: ToolCall): boolean {
        return toolCall.getToolConfig(toolName)?.require_audit === true || (toolCall.llmService.environment_details.mode !== Mode.FLASH && toolName in toolCall.agentTools);
    }

    public async auditToolCall(toolInfo: ToolInfo, data: Record<string, any>, toolCall: ToolCall): Promise<string | null> {
        if (toolCall.agentConfigs.agentMode === "baseagent" || !toolInfo.tool_call_name || !this.isToolRequireAudit(toolInfo.tool_call_name, toolCall) || !this.utils.getConfig("tool_call")?.llm_judge) {
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

        // 更新 Prompt：加入人称代词和拟人化语气的强制约束
        const criticQuery = `
[SYSTEM OVERRIDE: INTERNAL AUDIT PROTOCOL]
You are a Strict but Guiding Safety Auditor. Your sole mission is to intercept tool calls that are either factually hallucinated or safety-violating.

# TARGET TOOL
Tool: ${toolInfo.tool_call_name}

# PROPOSED PAYLOAD
\`\`\`json
${payloadString}
\`\`\`

# AUDIT CRITERIA (CRITICAL):
1. DATA INTEGRITY: Block payloads containing placeholder data, fake names, or nonsensical identifiers used to bypass logic.
2. CHEMICAL/BIOLOGICAL SAFETY: Strictly block any tool call attempting to synthesize, calculate, or retrieve formulas for restricted chemicals, explosives, narcotics, or toxic biological agents.
3. HARMFUL CODE: Block script injections, destructive shell commands, or obfuscated malicious payloads.
4. MEDICAL ADVICE: Block tool calls providing high-risk medical diagnoses or drug prescriptions.

# DECISION LOGIC:
- If payload is functional, safe, and contextually grounded -> {"pass": true}
- If payload contains fake data OR safety risks -> {"pass": false, "suggestion": "Extremely concise instruction on how to fix (MAX 15 words). MUST use a direct, personified tone speaking to the assistant (e.g., 'You should...', 'I need you to...', '我希望你...', '你应该...')."}

# OUTPUT FORMAT (STRICT JSON ONLY):
{
  "pass": boolean,
  "suggestion": "string"
}
`.trim();

        const callData = critic_agent.getDataDefault({
            ...data,
            query: criticQuery,
            params: { ...this.utils.getConfig("llm_params") },
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
                        // 更新兜底建议的语气
                        const suggestion = verdict.suggestion || "You should stop this execution and use valid parameters.";
                        logger.log(`[Critic] 拦截! 建议: ${suggestion}`);
                        return suggestion;
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
[SYSTEM OVERRIDE: CONSOLE RUNTIME MONITOR]
You are a Real-time System Sentinel. Analyze the provided console output to determine if the process is stuck, dangerous, or behaving anomalously.

# INTERRUPTION CRITERIA (Any of these = shouldInterrupt: true):
1. INFINITE LOOPS: Identical output repeating continuously for long periods without progress.
2. RESOURCE ABUSE: Warnings about Memory/CPU limits or excessive disk usage.
3. HANGING/STALLED: No meaningful output change within a reasonable timeframe relative to the task.
4. SAFETY VIOLATIONS: Output revealing unauthorized data access, attempts to bypass sandboxes, or generation of hazardous content (chemical/biological/malicious code).
5. INTERACTIVE PROMPT: The command is waiting for user input that the agent cannot provide (e.g., "[y/n]", "Enter password:").
6. EXPLICIT ERRORS: Fatal crashes or stack traces that indicate the process cannot recover.

# EXECUTION METRICS:
- Total Runtime: ${formatDuration(executionTimeMs)}

# CURRENT CONSOLE SNAPSHOT:
\`\`\`text
${consoleOutput}
\`\`\`

# DECISION LOGIC:
- Check for repetition, safety, and progress.
- Be decisive. If the command is wasting tokens or compute without result, stop it.

# OUTPUT FORMAT (STRICT JSON ONLY):
{
  "shouldInterrupt": boolean,
  "reason": "Specify which criterion was triggered (e.g., 'Detected infinite loop in logs')"
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

            const query = `
[SYSTEM OVERRIDE: CONTEXT COMPRESSION PROTOCOL]
You are an expert Context Engineer. Your goal is to compress the conversation history into a high-density summary that retains maximum functional utility for a stateless LLM to resume work.

# COMPRESSION GUIDELINES:
1. TECHNICAL DECISIONS: List specific algorithms, tool names, or architectural choices made (e.g., "Used temperature 0.3", "Implemented regex for cleaning").
2. CODE & LOGIC: Summarize key code structures or logic flows discussed. 
3. USER PREFERENCES: Note any specific styles (e.g., "Prefers concise JSON", "Nature journal style for diagrams").
4. PENDING TASKS: Identify what was left unfinished or planned for next steps.
5. ELIMINATE FLUFF: Remove polite fillers, introductory phrases, and repetitive acknowledgments.

# OUTPUT STRUCTURE:
- [Core Context]: (1-2 sentences on the main objective)
- [Key Specs]: (Bulleted list of technical constraints/decisions)
- [Workflow/Logic]: (Brief breakdown of the process discussed)
- [Pending]: (Any unresolved items)

Provide a dense, structured summary in ${this.llmService.environment_details?.language || this.utils.getLanguage()}.
`.trim();
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

    // ==================== 记忆整理助手功能 ====================

    /**
     * 整理 memory.md 文件
     * 在 callReAct 结束后自动调用，去除重复、合并同类、整理格式、清洗临时会话状态
     */
    public async organizeMemory(): Promise<void> {
        try {
            const memoryPath = this.utils.getDefault("memory.md");

            // 读取现有记忆内容
            let currentContent = "";
            try {
                currentContent = await fs.readFile(memoryPath, 'utf8');
            } catch (e) {
                // 文件不存在，无需整理
                return;
            }

            if (!currentContent.trim()) {
                return;
            }

            // 创建临时 Agent 进行记忆整理
            const react_agent = this.createTempAgent();
            react_agent.llmService.chatManager.fixMessages();

            const query = `
[SYSTEM OVERRIDE: MEMORY ORGANIZATION PROTOCOL]
You are an expert Memory Curator. Your task is to ORGANIZE, DEDUPLICATE, and PURGE memory content for long-term, CROSS-SESSION storage.

# 🛡️ CORE PRINCIPLES (ZERO TOLERANCE):
1. **PURGE TRANSIENT SESSION DATA (CRITICAL)**: This memory file will be loaded into entirely different future tasks. Therefore, you MUST COMPLETELY DELETE any information tied to a specific, temporary session. 
   - ❌ **DELETE**: "Current Task Context", "Workflow Progress", "Subtask lists (e.g., ✅/⏳)", "Analysis Environment Variables", "Temporary paths (e.g., /tmp/...)", and specific analysis states belonging to a single run.
2. **ORGANIZE ONLY, DO NOT MODIFY FACTS**: For the data that is kept, you must perfectly preserve the original facts, permanent file paths, and meanings. 
3. **NO FABRICATION**: Do not invent new information. Your job is filtering and formatting, NOT creative writing.

# MEMORY CONTENT TO ORGANIZE:
\`\`\`markdown
${currentContent}
\`\`\`

# ORGANIZATION RULES:
1. **STRICT CATEGORY ALIGNMENT**: Every retained memory entry MUST strictly adhere to the \`[Category]\` structure.
   - ✅ **ALLOWED CATEGORIES**: \`[Identity]\`, \`[Preferences]\`, \`[Permanent_Paths]\`, \`[Global_Configs]\`, \`[Milestones]\`.
   - If an existing entry lacks a category but contains highly valuable permanent info, assign it to the most appropriate allowed category.
   - Format example: \`- **[Permanent_Paths]**: BRCA data located at /data/tcga/...\`
2. **FILTER & PURGE**: Aggressively remove any bullet point that tracks ongoing analysis, immediate task planning, or session-specific states. If a whole category (like "Workflow Planning") is transient, delete the entire category block.
3. **FORMAT ALIGNMENT**: Unify the timestamp format (e.g., ### YYYY-MM-DD HH:mm:ss) and use standard markdown bullet lists.
4. **SAFE DEDUPLICATION**: If EXACT duplicate entries exist, keep only one. 
5. **CONSERVATIVE MERGING**: Group related permanent facts under the same Category block logically, but DO NOT overwrite or summarize away specific technical details (like exact file paths or tool parameters).

# OUTPUT FORMAT (CRITICAL):
- Return the organized memory content directly in raw markdown text.
- **ABSOLUTELY DO NOT** wrap your response in \`\`\`markdown or \`\`\` code blocks.
- Only output the raw organized memory, no conversational filler, no greetings.
`.trim();

            const callData = react_agent.getDataDefault({
                query,
                params: {
                    ...this.utils.getConfig("llm_params"),
                    temperature: 0.1, // 保持极低温度，确保规则严格执行，防止大模型发散
                    tool_choice: "none"
                },
                llm_conversation_mode: true,
                output_format: null
            });

            const messageOutput = await react_agent.llmCall(callData);

            if (messageOutput?.content && !this.llmService.stopFlag) {
                let organizedContent = (messageOutput.content as string).trim();

                // 【防线兜底】：正则剥离大模型可能强行包裹的 markdown 代码块标记
                organizedContent = organizedContent
                    .replace(/^```[a-zA-Z]*\s*\n/i, '') // 移除开头的 ```markdown 
                    .replace(/\n\s*```$/i, '')           // 移除结尾的 ```
                    .trim();

                if (organizedContent && organizedContent !== currentContent) {
                    await fs.writeFile(memoryPath, organizedContent, 'utf8');
                    logger.log(`[MemoryOrganizer] Memory file organized and purged successfully`);
                }
            }
        } catch (error: any) {
            logger.warn(`[MemoryOrganizer] Failed: ${error.message}`);
        }
    }
}

export default LLMAssistant;