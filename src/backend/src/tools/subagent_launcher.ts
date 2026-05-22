/**
 * subagent_launcher.ts
 *
 * 【职责】后台无阻塞启动常驻通用子代理（彻底解决长线守护失效与竞态冲突）。
 */

import { LLMService } from '../core/LLMService';
import { ToolCall } from '../core/ToolCall';
import { Plugins } from '../core/Plugins';
import { BackgroundTaskRegistry } from '../core/BackgroundTaskRegistry';
import type { PendingMessage } from '../core/BackgroundTaskRegistry';
import { State } from '../core/LLMBase';
import { parseJsonContent } from '../utils/public';
import * as os from 'os';
import { logger } from '../utils/logger';
import { store } from '../utils/globals';

// --- send_message 工具（内联创建，避免循环依赖）---
function createSendMessageTool(parentSessionId: string, agentName: string) {
    const func = async ({ to, message }: { to: string; message: string }) => {
        if (!to || !message) {
            return { success: false, message: '', error: 'Both "to" and "message" are required.' };
        }
        if (message.trim().length === 0) {
            return { success: false, message: '', error: 'Message cannot be empty.' };
        }
        try {
            BackgroundTaskRegistry.addAgentMessage(parentSessionId, agentName, to.trim(), message.trim());
            return { success: true, message: `Message sent to "${to}" successfully.` };
        } catch (error: any) {
            return { success: false, message: '', error: `Failed to send message: ${error.message}` };
        }
    };

    return {
        func,
        getPrompt: () => ({
            name: 'send_message',
            description:
                'Send a message to another agent in the team. Use this to report progress, request help, share findings, or coordinate with other agents.\n\n' +
                'ROUTING:\n' +
                '  - to: "main" → sends to the main (coordinator) agent\n' +
                '  - to: "all"  → broadcasts to the main agent AND all other sub-agents\n' +
                '  - to: "agent_name" → sends to a specific sub-agent by name\n\n' +
                'MANDATORY RULES:\n' +
                '  - CRITICAL: When you complete your task, you MUST call send_message to "main" with your results.\n' +
                '  - During long tasks, send intermediate progress updates to "main".\n' +
                '  - Completed (idle) sub-agents remain alive — you can re-engage them by sending a new message.',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Target agent name. Use "main" for the coordinator, "all" to broadcast, or a specific agent_name.' },
                    message: { type: 'string', description: 'The message content to send.' },
                },
                required: ['to', 'message'],
            },
        }),
    };
}

// --- 类型定义 ---
export interface SubAgentLauncherParams {
    timeout?: number;
}

export interface ExecuteArgs {
    agent_name: string;
    agent_prompt: string;
    query: string;
    tools?: string[];
    timeout?: number; // 传 0 或负数代表永不超时
    toolCall: ToolCall;
}

export interface ExecuteResult {
    success: boolean;
    task_id?: string;
    message?: string;
    error?: string;
}

const DEFAULT_TOOLS = [
    'python_execute',
    'display_file',
    'write_to_file',
    'list_dir',
    'grep_files',
    'find_files',
    'read_tools_prompt',
    'web_crawler_toolkit',
    'literature_search',
    'replace_in_file',
];

const FORBIDDEN_TOOLS = new Set(['ask_user', 'subagent_launcher', 'mcp_server']);

// --- 后台子代理执行器 ---
async function runSubAgentInBackground(
    taskId: string,
    parentSessionId: string,
    agentName: string,
    agentPrompt: string,
    query: string,
    toolNames: string[],
    timeout: number,
    parentUtils: any,
    mainToolCall: any,
    mainLLMService: LLMService,
    model: string,
    version: string,
    agentMode: string,
    toolFormat: string,
    parentMode: string,
): Promise<void> {
    let subAgentToolCall: ToolCall | null = null;
    let isProcessingMessage = false; // 🌟 引入状态互斥锁，彻底杜绝并发竞态

    try {
        const plugins = new Plugins(parentUtils);
        const allTools = plugins.getTool() as Record<string, any>;
        const filteredTools: Record<string, any> = {};

        filteredTools['send_message'] = createSendMessageTool(parentSessionId, agentName);

        for (const name of toolNames) {
            if (FORBIDDEN_TOOLS.has(name)) continue;
            const tool = allTools[name];
            if (tool && typeof tool.func === 'function' && typeof tool.getPrompt === 'function') {
                filteredTools[name] = tool;
            }
        }

        const llmService = new LLMService(undefined, null, parentUtils);
        llmService.chatManager.chat.id = parentSessionId;
        llmService.chatManager.chat.name = agentName;
        llmService.chatManager.chat.tool_format = toolFormat as 'toolcalls' | 'prompt';

        subAgentToolCall = new ToolCall(
            plugins,
            filteredTools,
            llmService,
            null,
            parentUtils,
            {
                agentPrompt: agentPrompt.trim() + '\n\n' +
                    '===\nMULTI-AGENT OPERATION RULES (MANDATORY)\n===\n' +
                    '1. When you finish your assigned workflow, you MUST call send_message to "main" with your results.\n' +
                    '2. After going idle, you remain alive and will be re-awakened automatically by new messages.',
                subagent: true,
                todolist: false,
                env: false,
                skill: false,
                mcpTool: false,
                mcpPrompt: false,
                agentName,
                agentMode: agentMode as 'transagent' | 'baseagent' | 'multagent',
            },
            mainLLMService,
        );

        subAgentToolCall.changeMode(parentMode === 'plan' ? 'auto' : parentMode);

        const dumpChatToOutputFile = async (): Promise<void> => {
            if (!subAgentToolCall) return;
            try {
                const fs = await import('fs');
                const msgs = subAgentToolCall.llmService.chatManager.messages;
                const lines = msgs.map(m => `[${m.role || 'unknown'}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
                fs.writeFileSync(os.tmpdir() + '/subagent_' + taskId + '.log', lines.join('\n\n'), 'utf-8');
            } catch (err: any) {
                logger.error(`[SubAgentLauncher] Failed to dump chat: ${err.message}`);
            }
        };

        // 🌟 核心提炼：抽取高度可靠的单一流式唤醒执行器
        const processPendingQueueAndRun = async (): Promise<void> => {
            if (!subAgentToolCall || isProcessingMessage) return;
            
            isProcessingMessage = true;
            try {
                while (true) {
                    const pendingMsgs = BackgroundTaskRegistry.drainMessages(subAgentToolCall.llmService.chatManager.chat.id);
                    if (!pendingMsgs || pendingMsgs.length === 0) break;

                    logger.log(`[SubAgentLauncher] Agent "${agentName}" consumption loop processing ${pendingMsgs.length} message(s)`);
                    
                    for (const pm of pendingMsgs) {
                        const msgs = subAgentToolCall.llmService.chatManager.messages;
                        const last = msgs[msgs.length - 1];
                        if (last) {
                            last.content = (last.content || '') + '\n' + pm.content;
                        }
                    }

                    BackgroundTaskRegistry.markRunning(taskId);
                    subAgentToolCall.llmService.stopFlag = false;
                    const wd = subAgentToolCall.getDataDefault({ query: '', model, version });
                    wd.uuid = subAgentToolCall.llmService.chatManager.uuid;
                    
                    await subAgentToolCall.callReAct(wd, false, true);
                    await dumpChatToOutputFile();
                }
            } catch (err: any) {
                logger.error(`[SubAgentLauncher] Error during agent "${agentName}" ReAct execution:`, err);
            } finally {
                isProcessingMessage = false;
            }
        };

        // 🌟 订阅全自动事件驱动源（绝无轮询，确保永远在线）
        BackgroundTaskRegistry.registerAgentListener(
            parentSessionId,
            agentName,
            (msg) => {
                if (!subAgentToolCall) return;

                const msgText = `\n📨 **Message from [${msg.from}]**:\n${msg.content}`;

                // 运行时守卫：如果子代理本身处于活跃状态，塞回队列交由底层系统机制在下一次 Tool 调用前 drain
                if (subAgentToolCall.state !== State.IDLE && subAgentToolCall.state !== State.FINAL) {
                    logger.log(`[SubAgentLauncher] Agent "${agentName}" is busy (${subAgentToolCall.state}), queuing for native middleware intake.`);
                    BackgroundTaskRegistry.requeueForMiddleware(subAgentToolCall.llmService.chatManager.chat.id, {
                        type: 'agent_message',
                        content: msgText,
                        timestamp: Date.now(),
                    });
                    return;
                }

                // 空闲时守护：直接把消息追加到上一轮对话末尾，触发链式 ReAct 运转
                const agentMessages = subAgentToolCall.llmService.chatManager.messages;
                const agentLastMsg = agentMessages[agentMessages.length - 1];
                if (agentLastMsg) {
                    agentLastMsg.content = (agentLastMsg.content || '') + msgText;
                }

                logger.log(`[SubAgentLauncher] Event-Trigger: Waking up idle agent "${agentName}" via Listener`);
                processPendingQueueAndRun().catch(err => logger.error(`[SubAgentLauncher] Async run crash:`, err));
            }
        );

        if (parentUtils.getConfig('toolCall')?.subagent_llm_init) {
            subAgentToolCall.llmService.chatManager.initMessages();
        }

        subAgentToolCall.llmService.startLoop();
        const data = subAgentToolCall.getDataDefault({ query, model, version });

        // 🚀 首轮主干任务分流启动
        let resultData;
        if (timeout > 0) {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Sub-agent "${agentName}" timed out after ${timeout}s`)), timeout * 1000);
            });
            resultData = await Promise.race([subAgentToolCall.callReAct(data), timeoutPromise]);
        } else {
            logger.log(`[SubAgentLauncher] Daemon Agent "${agentName}" initialized under PERMANENT (infinite) lifecycle.`);
            resultData = await subAgentToolCall.callReAct(data);
        }

        const resJson = parseJsonContent(resultData.output_format);
        let result = resJson[0]?.content || resultData.output_format || 'Sub-agent completed initial task with no return payload.';
        result = result.replace(/\n+={10,}\n[\s\S]*$/, '').trim();
        
        await dumpChatToOutputFile();

        BackgroundTaskRegistry.addAgentCompletionNotice(parentSessionId, taskId, agentName, result);
        logger.log(`[SubAgentLauncher] Agent "${agentName}" completed initial execution chain.`);

        // 主任务完成后，立即清空在此期间可能积压的所有二线消息
        await processPendingQueueAndRun();

    } catch (error: any) {
        logger.error(`[SubAgentLauncher] Fatal crash on agent "${agentName}": ${error.message}`);
        BackgroundTaskRegistry.addMessage(
            parentSessionId,
            taskId,
            `❌ **Background sub-agent \`${agentName}\` encountered an exception.**\n\n**Error:** ${error.message}`
        );
    }

    // ── 🌟 常驻不死自锁区 (PERMANENT DAEMON SIGNAL LOCK) ──────────────────
    logger.log(`[SubAgentLauncher] Daemon "${agentName}" state context frozen in memory. Standing by forever.`);
    
    // 通过无解 Promise 彻底卡住当前异步上下文栈，使其不销毁、不退出。
    // 所有后续的数据流动由顶层 registerAgentListener 事件完全闭环驱动！
    await new Promise<void>(() => { /* Identity retained until the master session is cleared */ });
}

// --- 主入口 ---
export function main(initialParams: SubAgentLauncherParams = {}) {
    return async ({
        agent_name,
        agent_prompt,
        query,
        tools,
        timeout,
        toolCall,
    }: ExecuteArgs): Promise<ExecuteResult> => {
        if (!agent_name?.trim()) return { success: false, error: 'The "agent_name" parameter is required.' };
        if (!agent_prompt?.trim()) return { success: false, error: 'The "agent_prompt" parameter is required.' };
        if (!query?.trim()) return { success: false, error: 'The "query" parameter is required.' };

        const sanitizedName = agent_name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const taskId = `sbagent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const sessionId = toolCall.llmService.chatManager.chat.id;
        
        const effectiveTimeout = typeof timeout === 'number' ? timeout : 0; 
        const toolNames = (tools && tools.length > 0) ? tools : DEFAULT_TOOLS;

        const mainChat = toolCall.llmService.chatManager.chat;
        const mainLLMService = toolCall.mainLLMService || toolCall.llmService;

        BackgroundTaskRegistry.addTaskStart(
            sessionId,
            taskId,
            'subagent_launcher',
            `agent: ${sanitizedName} | query: ${query.substring(0, 80)}`,
        );

        BackgroundTaskRegistry.setTaskOutputFile(taskId, os.tmpdir() + '/subagent_' + taskId + '.log');
        logger.log(`[SubAgentLauncher] Dispatching asynchronous worker thread for daemon [${sanitizedName}]`);

        setImmediate(() => {
            runSubAgentInBackground(
                taskId,
                sessionId,
                sanitizedName,
                agent_prompt.trim(),
                query.trim(),
                toolNames,
                effectiveTimeout,
                toolCall.utils,
                toolCall,
                mainLLMService,
                mainChat.model || 'gpt-4o',
                mainChat.version || '',
                store.get('agentMode', 'transagent') as 'transagent' | 'baseagent' | 'multagent',
                mainChat.tool_format || 'toolcalls',
                mainChat.mode || 'auto',
            ).catch((err: Error) => {
                logger.error(`[SubAgentLauncher] Fatal top-level asynchronous crash for agent "${sanitizedName}":`, err);
                BackgroundTaskRegistry.addMessage(
                    sessionId,
                    taskId,
                    `❌ **Background sub-agent \`${sanitizedName}\` process died.**\n\n**Error:** ${err.message}`
                );
            });
        });

        return {
            success: true,
            task_id: taskId,
            message: `Background sub-agent \`${sanitizedName}\` successfully established in persistent daemon space. Task ID: ${taskId}`,
        };
    };
}

export function getPrompt() {
    return {
        name: 'subagent_launcher',
        description:
            'Launch a persistent, non-blocking sub-agent daemon in the background.\n\n' +
            'By default, sub-agents run with INFINITE lifetime (timeout=0) and remain responsive in standby mode. ' +
            'They will automatically awaken whenever a new message is directed to them via the send_message tool.',
        parameters: {
            type: 'object',
            properties: {
                agent_name: { type: 'string', description: 'Unique identifier for this sub-agent (alphanumeric/underscores/hyphens only).' },
                agent_prompt: { type: 'string', description: 'System prompt defining the role, specialized persona, and operational boundaries.' },
                query: { type: 'string', description: 'The initial task instruction for the agent to execute immediately.' },
                tools: { type: 'array', items: { type: 'string' }, description: 'Allowed tools list. Omit to assign infrastructure defaults.' },
                timeout: { type: 'number', description: 'Max runtime constraint in seconds. Set to 0 or leave omitted for permanent daemon lifecycle.' },
            },
            required: ['agent_name', 'agent_prompt', 'query'],
        },
    };
}