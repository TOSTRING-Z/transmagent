import { WindowManager } from '../main/windows/WindowManager';
import { logger } from '../utils/logger';

// --- 类型定义 ---
export interface UpdateEnvParams {
    key: string;
    value: any;
}

export interface UpdateEnvResult {
    success: boolean;
    key?: string;
    message?: string;
    error?: string;
}

export function main() {
    return async (params: UpdateEnvParams): Promise<UpdateEnvResult> => {
        try {
            const { key, value } = params;

            if (!key || value === undefined) {
                throw new Error("Both key and value parameters are required");
            }

            // 获取当前的 chatState
            const chatState = WindowManager.instance.mainWindow.llm_service.chatManager.chat;

            // 确保 envs 对象存在
            if (!chatState.envs) {
                chatState.envs = {};
            }

            // 写入或更新环境变量
            chatState.envs[key] = value;

            logger.log(`写入环境变量成功: ${key} = ${typeof value === 'object' ? JSON.stringify(value) : value}`);

            return {
                success: true,
                key: key,
                message: `Environment variable '${key}' has been successfully set/updated.`
            };

        } catch (error: any) {
            logger.error(`Update env failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export function getPrompt() {
    return {
        "name": "update_env",
        "description": "Writes or updates an environment variable in the global `envs` object. CRITICAL: Use this tool to record important analytical processes, learned experiences, generated output file paths, working directories, and other key information so that context is not lost in future turns.",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "The name of the environment variable (e.g., 'working_dir', 'compile_experience', 'latest_output_file'). Use clear, descriptive keys."
                },
                "value": {
                    "type": "string", // 根据实际需要也可以改为 "any" 或支持复杂对象
                    "description": "The value or content to store. Keep the information highly relevant and concise."
                }
            },
            "required": [
                "key",
                "value"
            ]
        }
    };
}