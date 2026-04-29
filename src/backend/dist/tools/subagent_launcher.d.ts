/**
 * subagent_launcher.ts
 *
 * 【职责】后台无阻塞启动通用子代理。
 *
 * 工作流：
 *   1. 主代理调用此工具，传入 agent_prompt + query + tools。
 *   2. 工具立即返回 task_id（非阻塞）。
 *   3. 子代理在后台运行 ReAct 循环。
 *   4. 完成后，结果通过 BackgroundTaskRegistry 注入主代理会话。
 *   5. 子代理可通过 send_message 与其他代理通信。
 *
 * 安全约束：
 *   - 子代理无 ask_user（防止阻塞）
 *   - 子代理无 subagent_launcher（防止递归）
 *   - 子代理无 mcp_server（避免 MCP 冲突）
 *   - 超时自动终止
 */
import { ToolCall } from '../core/ToolCall';
export interface SubAgentLauncherParams {
    timeout?: number;
}
export interface ExecuteArgs {
    agent_name: string;
    agent_prompt: string;
    query: string;
    tools?: string[];
    timeout?: number;
    toolCall: ToolCall;
}
export interface ExecuteResult {
    success: boolean;
    task_id?: string;
    message?: string;
    error?: string;
}
export declare function main(initialParams?: SubAgentLauncherParams): ({ agent_name, agent_prompt, query, tools, timeout, toolCall, }: ExecuteArgs) => Promise<ExecuteResult>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            agent_name: {
                type: string;
                description: string;
            };
            agent_prompt: {
                type: string;
                description: string;
            };
            query: {
                type: string;
                description: string;
            };
            tools: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
