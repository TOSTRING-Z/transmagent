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
export declare function main(initialParams?: {
    parentSessionId?: string;
    agentName?: string;
}): ({ to, message }: SendMessageArgs) => Promise<SendMessageResult>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            to: {
                type: string;
                description: string;
            };
            message: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
