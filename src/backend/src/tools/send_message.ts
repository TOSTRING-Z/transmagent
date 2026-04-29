/**
 * send_message.ts
 *
 * 【职责】代理间通信工具——供主代理和子代理相互发送消息。
 *
 * 路由机制：
 *   消息通过 BackgroundTaskRegistry.addAgentMessage 投递：
 *     - to: "main" → 注入主代理会话
 *     - to: "all"  → 注入主代理会话 + 广播所有子代理
 *     - to: "agent_name" → 定向投递到指定子代理
 *
 * 动态推导：
 *   - 子代理场景：parentSessionId 和 agentName 由 subagent_launcher 注入
 *   - 主代理场景：sessionId 和 agentName 从 toolCall 运行时动态获取
 */

import { BackgroundTaskRegistry } from '../core/BackgroundTaskRegistry';

// --- 类型定义 ---

export interface SendMessageParams {
    /** 目标代理名称：'main' / 'all' / 具体 agent_name */
    to: string;
    /** 消息正文 */
    message: string;
}

export interface SendMessageArgs extends SendMessageParams {
    toolCall: any;
}

export interface SendMessageResult {
    success: boolean;
    message: string;
    error?: string;
}

// --- 辅助函数 ---

function validateParams(params: SendMessageParams): string | null {
    if (!params || typeof params !== 'object') {
        return 'Parameters are required';
    }
    if (!params.to || typeof params.to !== 'string') {
        return 'The "to" parameter is required and must be a string';
    }
    if (!params.message || typeof params.message !== 'string') {
        return 'The "message" parameter is required and must be a string';
    }
    if (params.message.trim().length === 0) {
        return 'Message cannot be empty';
    }
    return null;
}

// --- 主逻辑 ---

export function main(initialParams: { parentSessionId?: string; agentName?: string } = {}) {
    const { parentSessionId = '', agentName = '' } = initialParams;

    return async ({ to, message, toolCall }: SendMessageArgs): Promise<SendMessageResult> => {
        const validationError = validateParams({ to, message });
        if (validationError) {
            return { success: false, message: '', error: validationError };
        }

        // 【修改点】：修复主代理场景下获取 sessionId 的路径，保持与 Launcher 一致使用 chat.id
        const sessionId = 
            parentSessionId || 
            toolCall?.llmService?.chatManager?.chat?.id || 
            '';
            
        const fromAgent = agentName || toolCall?.agentConfigs?.agentName || 'main';

        if (!sessionId) {
            return {
                success: false,
                message: '',
                error: 'send_message: session ID could not be determined. Ensure the tool is called within an active agent session.',
            };
        }

        try {
            BackgroundTaskRegistry.addAgentMessage(
                sessionId,
                fromAgent,
                to.trim(),
                message.trim(),
            );

            return {
                success: true,
                message: `Message sent to "${to}" successfully.`,
            };
        } catch (error: any) {
            return {
                success: false,
                message: '',
                error: `Failed to send message: ${error.message}`,
            };
        }
    };
}

export function getPrompt() {
    return {
        name: 'send_message',
        description:
            'Send a message to another agent in the team. Use this to report progress, request help, share findings, or coordinate with other agents.\n\n' +
            'ROUTING:\n' +
            '  - to: "main" → sends to the main (coordinator) agent\n' +
            '  - to: "all"  → broadcasts to the main agent AND all other sub-agents\n' +
            '  - to: "agent_name" → sends to a specific sub-agent by name\n\n' +
            'Use this tool to collaborate with your fellow agents during long-running background tasks.',
        parameters: {
            type: 'object',
            properties: {
                to: {
                    type: 'string',
                    description: 'Target agent name. Use "main" for the coordinator, "all" to broadcast, or a specific agent_name.',
                },
                message: {
                    type: 'string',
                    description: 'The message content to send.',
                },
            },
            required: ['to', 'message'],
        },
    };
}
