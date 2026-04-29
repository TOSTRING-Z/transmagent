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
}): ({ to, message, toolCall }: SendMessageArgs) => Promise<SendMessageResult>;
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
