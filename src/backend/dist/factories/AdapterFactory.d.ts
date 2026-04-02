import { ILLMAdapter, IToolCallAdapter } from '../adapters/IAdapter';
export declare class LLMAdapterFactory {
    /**
     * 获取 API 通信适配器
     * 负责与不同 API (OpenAI/Anthropic/Ollama) 通信，返回统一的 Message 格式
     */
    static getAdapter(apiType: string): ILLMAdapter;
}
export declare class ToolCallAdapterFactory {
    /**
     * 获取工具调用解析适配器
     * 负责从统一格式的 Message 中提取工具调用
     *
     * @param format - 工具格式类型
     *   - 'toolcalls': 直接从 message.tool_calls 提取（需要模型支持 Native Tool Calls）
     *   - 'prompt': 解析 message.content 中的 JSON 字符串（适用于所有模型）
     */
    static getAdapter(format: string): IToolCallAdapter;
}
