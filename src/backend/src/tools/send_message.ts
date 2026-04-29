/**
 * send_message.ts
 *
 * 【职责】代理间通信工具——供后台子代理使用，向主代理或其他子代理发送消息。
 *
 * 路由机制：
 *   消息通过 BackgroundTaskRegistry.addAgentMessage 投递：
 *     - to: "main" → 注入主代理会话
 *     - to: "all"  → 注入主代理会话 + 广播所有子代理
 *     - to: "agent_name" → 定向投递到指定子代理
 *
 * 注意：
 *   - 此工具仅供子代理使用，主代理不应拥有此工具。
 *   - parentSessionId 和 agentName 在 subagent_launcher 创建工具实例时通过 params 注入。
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
    const { parentSessionId = '', agentName = 'unknown' } = initialParams;

    return async ({ to, message }: SendMessageArgs): Promise<SendMessageResult> => {
        const validationError = validateParams({ to, message });
        if (validationError) {
            return { success: false, message: '', error: validationError };
        }

        if (!parentSessionId) {
            return {
                success: false,
                message: '',
                error: 'send_message: parentSessionId is not configured. This tool must be used within a background sub-agent.',
            };
        }

        try {
            BackgroundTaskRegistry.addAgentMessage(
                parentSessionId,
                agentName,
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
