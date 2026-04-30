"use strict";
/**
 * subagent_launcher.ts
 *
 * 【职责】后台无阻塞启动通用子代理。
 *
 * 工作流：
 *   1. 主代理调用此工具，传入 agent_prompt + query + tools。
 *   2. 工具立即返回 task_id（非阻塞）。
 *   3. 子代理在后台运行 ReAct 循环。
 *   4. 运行期间：子代理可通过 send_message (底层 addAgentMessage) 与主代理/其他代理实时通信。
 *   5. 运行结束：结果通过 BackgroundTaskRegistry.addMessage (携带 taskId) 核销任务并注入主会话。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
exports.getPrompt = getPrompt;
const LLMService_1 = require("../core/LLMService");
const ToolCall_1 = require("../core/ToolCall");
const Plugins_1 = require("../core/Plugins");
const BackgroundTaskRegistry_1 = require("../core/BackgroundTaskRegistry"); // 移除了未使用的 PendingMessage
const LLMBase_1 = require("../core/LLMBase");
const public_1 = require("../utils/public");
const logger_1 = require("../utils/logger");
const globals_1 = require("../utils/globals");
// --- send_message 工具（内联创建，避免循环依赖）---
function createSendMessageTool(parentSessionId, agentName) {
    const func = async ({ to, message }) => {
        if (!to || !message) {
            return { success: false, message: '', error: 'Both "to" and "message" are required.' };
        }
        if (message.trim().length === 0) {
            return { success: false, message: '', error: 'Message cannot be empty.' };
        }
        try {
            // 【通信通道】这里使用 addAgentMessage，因为它属于运行中的“代理间消息投递”，不干涉任务生命周期
            BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(parentSessionId, agentName, to.trim(), message.trim());
            return { success: true, message: `Message sent to "${to}" successfully.` };
        }
        catch (error) {
            return { success: false, message: '', error: `Failed to send message: ${error.message}` };
        }
    };
    return {
        func,
        getPrompt: () => ({
            name: 'send_message',
            description: 'Send a message to another agent in the team. Use this to report progress, request help, share findings, or coordinate with other agents.\n\n' +
                'ROUTING:\n' +
                '  - to: "main" → sends to the main (coordinator) agent\n' +
                '  - to: "all"  → broadcasts to the main agent AND all other sub-agents\n' +
                '  - to: "agent_name" → sends to a specific sub-agent by name',
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
// --- 默认工具集 ---
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
/** 禁止授予子代理的工具 */
const FORBIDDEN_TOOLS = new Set([
    'ask_user',
    'subagent_launcher',
    'mcp_server',
]);
// --- 后台子代理执行器 ---
async function runSubAgentInBackground(taskId, parentSessionId, agentName, agentPrompt, query, toolNames, timeout, parentUtils, mainToolCall, mainLLMService, model, version, agentMode, toolFormat, parentMode) {
    let subAgentToolCall = null;
    try {
        const plugins = new Plugins_1.Plugins(parentUtils);
        const allTools = plugins.getTool();
        const filteredTools = {};
        // 强行注入 send_message 工具
        filteredTools['send_message'] = createSendMessageTool(parentSessionId, agentName);
        for (const name of toolNames) {
            if (FORBIDDEN_TOOLS.has(name)) {
                logger_1.logger.warn(`[SubAgentLauncher] Skipping forbidden tool "${name}" for agent "${agentName}"`);
                continue;
            }
            const tool = allTools[name];
            if (tool && typeof tool.func === 'function' && typeof tool.getPrompt === 'function') {
                filteredTools[name] = tool;
            }
            else {
                logger_1.logger.warn(`[SubAgentLauncher] Tool "${name}" not found or invalid, skipping.`);
            }
        }
        logger_1.logger.log(`[SubAgentLauncher] Agent "${agentName}" starting with tools: [${Object.keys(filteredTools).join(', ')}]`);
        const llmService = new LLMService_1.LLMService(undefined, null, parentUtils);
        llmService.chatManager.chat.id = parentSessionId;
        llmService.chatManager.chat.name = agentName;
        llmService.chatManager.chat.tool_format = toolFormat;
        subAgentToolCall = new ToolCall_1.ToolCall(plugins, filteredTools, llmService, null, parentUtils, {
            agentPrompt,
            subagent: true,
            todolist: false,
            env: true,
            skill: false,
            mcpTool: false,
            mcpPrompt: false,
            agentName,
            agentMode: agentMode,
        }, mainLLMService);
        if (parentMode !== 'plan') {
            subAgentToolCall.changeMode(parentMode);
        }
        else {
            subAgentToolCall.changeMode('auto');
        }
        // 注册代理消息监听器（接收主代理或其他子代理发来的 AgentMessage）
        // ── 递归 drain：callReAct 完成后检查 agentMsgQueues 是否有积压消息 ──
        const drainAndProcess = () => {
            const queued = BackgroundTaskRegistry_1.BackgroundTaskRegistry.drainAgentMessages(parentSessionId, agentName);
            if (!queued || queued.length === 0)
                return;
            logger_1.logger.log(`[SubAgentLauncher] Agent "${agentName}" draining ${queued.length} queued message(s)`);
            // 追加所有积压消息到 chat
            for (const qm of queued) {
                const text = `\n📨 **Message from [${qm.from}]**:\n${qm.content}`;
                const msgs = subAgentToolCall.llmService.chatManager.messages;
                const last = msgs[msgs.length - 1];
                if (last) {
                    last.content = (last.content || '') + text;
                }
            }
            // 唤醒处理
            subAgentToolCall.llmService.stopFlag = false;
            const wd = subAgentToolCall.getDataDefault({ query: '', model, version });
            wd.uuid = subAgentToolCall.llmService.chatManager.uuid;
            subAgentToolCall.callReAct(wd, false, true)
                .then(() => drainAndProcess()) // 递归检查
                .catch((err) => {
                logger_1.logger.error(`[SubAgentLauncher] Agent "${agentName}" drain error:`, err);
            });
        };
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(parentSessionId, agentName, (msg) => {
            if (!subAgentToolCall)
                return;
            // ── 活跃状态守卫：子代理正在处理，不可直接注入 chat ──
            // 将消息入队 agentMsgQueues，由 drainAndProcess 在 callReAct 完成后取出
            if (subAgentToolCall.state !== LLMBase_1.State.IDLE &&
                subAgentToolCall.state !== LLMBase_1.State.FINAL) {
                logger_1.logger.log(`[SubAgentLauncher] Agent "${agentName}" is active (${subAgentToolCall.state}), ` +
                    `queuing message from "${msg.from}"`);
                BackgroundTaskRegistry_1.BackgroundTaskRegistry.queueAgentMessage(parentSessionId, agentName, msg);
                return;
            }
            // ── 空闲状态：直接注入 + 唤醒 + 唤醒后递归 drain ──
            logger_1.logger.log(`[SubAgentLauncher] Agent "${agentName}" received message from "${msg.from}"`);
            const msgText = `\n📨 **Message from [${msg.from}]**:\n${msg.content}`;
            const agentMessages = subAgentToolCall.llmService.chatManager.messages;
            const agentLastMsg = agentMessages[agentMessages.length - 1];
            if (agentLastMsg) {
                agentLastMsg.content = (agentLastMsg.content || '') + msgText;
            }
            logger_1.logger.log(`[SubAgentLauncher] Waking agent "${agentName}" for incoming message`);
            subAgentToolCall.llmService.stopFlag = false;
            const wakeData = subAgentToolCall.getDataDefault({ query: '', model, version });
            wakeData.uuid = subAgentToolCall.llmService.chatManager.uuid;
            subAgentToolCall.callReAct(wakeData, false, true)
                .then(() => drainAndProcess()) // 唤醒完成后递归检查积压消息
                .catch((err) => {
                logger_1.logger.error(`[SubAgentLauncher] Agent "${agentName}" wake-up error:`, err);
            });
        });
        if (parentUtils.getConfig('toolCall')?.subagent_llm_init) {
            subAgentToolCall.llmService.chatManager.initMessages();
        }
        subAgentToolCall.llmService.startLoop();
        let data = subAgentToolCall.getDataDefault({ query, model, version });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Sub-agent "${agentName}" timed out after ${timeout}s`));
            }, timeout * 1000);
        });
        const resultData = await Promise.race([
            subAgentToolCall.callReAct(data),
            timeoutPromise,
        ]);
        const resJson = (0, public_1.parseJsonContent)(resultData.output_format);
        const result = resJson[0]?.content || resultData.output_format || 'Sub-agent completed with no output.';
        // 【任务核销通道】子代理生命周期结束，必须调用 addMessage 附带 taskId，触发 markCompleted 消除前端 Loading。
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.addMessage(parentSessionId, taskId, `✅ **Background sub-agent \`${agentName}\` completed.**\n\n**Result:**\n${result}`, true // skipMarkCompleted: 非瞬态生命周期，任务保持可见
        );
        logger_1.logger.log(`[SubAgentLauncher] Agent "${agentName}" completed successfully`);
    }
    catch (error) {
        logger_1.logger.error(`[SubAgentLauncher] Agent "${agentName}" failed: ${error.message}`);
        // 【任务异常核销】同上，发送错误信息给主代理并核销 taskId
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.addMessage(parentSessionId, taskId, `❌ **Background sub-agent \`${agentName}\` failed.**\n\n**Error:** ${error.message}`, true // skipMarkCompleted: 非瞬态生命周期，任务保持可见
        );
    }
    // ── NON-TRANSIENT LIFECYCLE ──────────────────────────────────────────
    // 子代理主任务完成后不退出，保持存活以接收后续消息。
    // Listener 回调处理消息投递 + callReAct 唤醒；此 Promise 永不 resolve，
    // 函数不返回，finally 逻辑被跳过，listener 保持注册。
    logger_1.logger.log(`[SubAgentLauncher] Agent "${agentName}" entering idle mode, awaiting messages...`);
    await new Promise(() => {
        // 永不 resolve —— 保持异步函数存活，直至 session 清理或进程终止
    });
}
// --- 主入口 ---
function main(initialParams = {}) {
    return async ({ agent_name, agent_prompt, query, tools, timeout, toolCall, }) => {
        if (!agent_name || typeof agent_name !== 'string' || agent_name.trim().length === 0) {
            return { success: false, error: 'The "agent_name" parameter is required and must be a non-empty string.' };
        }
        if (!agent_prompt || typeof agent_prompt !== 'string' || agent_prompt.trim().length === 0) {
            return { success: false, error: 'The "agent_prompt" parameter is required and must be a non-empty string.' };
        }
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return { success: false, error: 'The "query" parameter is required and must be a non-empty string.' };
        }
        const sanitizedName = agent_name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const taskId = `sbagent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const sessionId = toolCall.llmService.chatManager.chat.id;
        const effectiveTimeout = (typeof timeout === 'number' && timeout > 0) ? timeout : 600;
        const toolNames = (tools && tools.length > 0) ? tools : DEFAULT_TOOLS;
        const mainChat = toolCall.llmService.chatManager.chat;
        const mainLLMService = toolCall.mainLLMService || toolCall.llmService;
        // 【任务生命周期起点】注册 Task
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.addTaskStart(sessionId, taskId, 'subagent_launcher', `agent: ${sanitizedName} | query: ${query.substring(0, 80)}`);
        logger_1.logger.log(`[SubAgentLauncher] Launching agent "${sanitizedName}" (task: ${taskId}) in session "${sessionId}"`);
        setImmediate(() => {
            runSubAgentInBackground(taskId, sessionId, sanitizedName, agent_prompt.trim(), query.trim(), toolNames, effectiveTimeout, toolCall.utils, toolCall, mainLLMService, mainChat.model || 'gpt-4o', mainChat.version || '', globals_1.store.get('agentMode', 'transagent'), mainChat.tool_format || 'toolcalls', mainChat.mode || 'auto').catch((err) => {
                logger_1.logger.error(`[SubAgentLauncher] Fatal error launching agent "${sanitizedName}":`, err);
                // 【任务异常核销】处理进程级别的崩溃
                BackgroundTaskRegistry_1.BackgroundTaskRegistry.addMessage(sessionId, taskId, `❌ **Background sub-agent \`${sanitizedName}\` failed to start.**\n\n**Error:** ${err.message}`);
            });
        });
        // 立刻向大模型返回成功执行并附上 taskId，让主对话流程继续往下走
        return {
            success: true,
            task_id: taskId,
            message: `Background sub-agent \`${sanitizedName}\` started. Task ID: ${taskId}`,
        };
    };
}
function getPrompt() {
    return {
        name: 'subagent_launcher',
        // (保持原有的 description / parameters 不变) ...
        description: 'Launch a generic sub-agent in the background (non-blocking).\n\n' +
            'The sub-agent runs asynchronously with a custom system prompt defining its identity and behavior. ' +
            'It can communicate with other agents using the send_message tool. ' +
            'Results are automatically injected into the conversation when the sub-agent completes.\n\n' +
            'USE CASES:\n' +
            '  - Parallel data analysis: launch multiple analysts on different datasets\n' +
            '  - Code review: launch a reviewer while you continue working\n' +
            '  - Research delegation: launch a researcher to gather information\n' +
            '  - Multi-agent collaboration: build a team of specialized agents\n\n' +
            'SECURITY:\n' +
            '  - Sub-agents do NOT have the ask_user tool (to prevent blocking)\n' +
            '  - Sub-agents do NOT have the subagent_launcher tool (to prevent recursion)\n' +
            '  - Sub-agents CAN use send_message to report back or communicate with peers\n\n' +
            '⚠️ After launching a background sub-agent, the main agent MUST continue working. ' +
            'Results will be delivered automatically.',
        parameters: {
            type: 'object',
            properties: {
                agent_name: {
                    type: 'string',
                    description: 'A unique identifier for this sub-agent (e.g., "data_analyzer_01", "code_reviewer"). ' +
                        'Only alphanumeric characters, underscores and hyphens are allowed.',
                },
                agent_prompt: {
                    type: 'string',
                    description: 'The system prompt that defines the sub-agent\'s identity, expertise, and behavior. ' +
                        'Be specific about the agent\'s role, capabilities, and expected output format.',
                },
                query: {
                    type: 'string',
                    description: 'The task description or question the sub-agent should work on.',
                },
                tools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of tool names to grant the sub-agent. ' +
                        'Default tools if not specified: cli_execute, python_execute, display_file, write_to_file, ' +
                        'list_dir, grep_files, find_files, read_tools_prompt, web_crawler_toolkit, literature_search, replace_in_file. ' +
                        'The send_message tool is always included automatically.',
                },
                timeout: {
                    type: 'number',
                    description: 'Maximum execution time in seconds (default: 600). The sub-agent will be terminated if it exceeds this limit.',
                },
            },
            required: ['agent_name', 'agent_prompt', 'query'],
        },
    };
}
//# sourceMappingURL=subagent_launcher.js.map