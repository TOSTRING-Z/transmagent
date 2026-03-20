/**
 * 工业级文件写入工具 (精简版)
 * * 核心逻辑：
 * 1. 极简的 Overwrite & Append 模式，完美契合大模型“自回归”天性。
 * 2. 遇到 Token 截断时，大模型在下一轮可自然而然地使用 mode='append' 续写。
 * 3. 统一本地与 SSH 远程支持，自动处理不存在的父级目录。
 * 4. 无状态 (Stateless) 设计，完全规避进程重启或执行中断导致的状态机错乱问题。
 */
export interface WriteToFileParams {
    file_path: string;
    content?: string;
    mode?: 'overwrite' | 'append';
}
export declare function main(): (params: WriteToFileParams) => Promise<string>;
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            file_path: {
                type: string;
                description: string;
            };
            content: {
                type: string;
                description: string;
            };
            mode: {
                type: string;
                description: string;
                enum: string[];
                default: string;
            };
        };
        required: string[];
        additionalProperties: boolean;
    };
};
