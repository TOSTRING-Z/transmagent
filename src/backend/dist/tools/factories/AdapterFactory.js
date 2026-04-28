"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolCallAdapterFactory = exports.LLMAdapterFactory = void 0;
const AnthropicAdapter_1 = require("../adapters/AnthropicAdapter");
const OllamaAdapter_1 = require("../adapters/OllamaAdapter");
const OpenAIAdapter_1 = require("../adapters/OpenAIAdapter");
const PromptAdapter_1 = require("../adapters/PromptAdapter");
const ToolCallsAdapter_1 = require("../adapters/ToolCallsAdapter");
class LLMAdapterFactory {
    /**
     * 获取 API 通信适配器
     * 负责与不同 API (OpenAI/Anthropic/Ollama) 通信，返回统一的 Message 格式
     */
    static getAdapter(apiType) {
        switch (apiType) {
            case 'openai':
                return new OpenAIAdapter_1.OpenAIAdapter();
            case 'anthropic':
                return new AnthropicAdapter_1.AnthropicAdapter();
            case 'ollama':
                return new OllamaAdapter_1.OllamaAdapter();
            default:
                // prompt 模式使用 OpenAI 格式（兼容大多数本地模型）
                return new OpenAIAdapter_1.OpenAIAdapter();
        }
    }
}
exports.LLMAdapterFactory = LLMAdapterFactory;
class ToolCallAdapterFactory {
    /**
     * 获取工具调用解析适配器
     * 负责从统一格式的 Message 中提取工具调用
     *
     * @param format - 工具格式类型
     *   - 'toolcalls': 直接从 message.tool_calls 提取（需要模型支持 Native Tool Calls）
     *   - 'prompt': 解析 message.content 中的 JSON 字符串（适用于所有模型）
     */
    static getAdapter(format) {
        switch (format) {
            case 'toolcalls':
                return new ToolCallsAdapter_1.ToolCallsAdapter();
            case 'prompt':
                return new PromptAdapter_1.PromptToolCallAdapter();
            default:
                // 默认尝试 tool_calls，如果模型不支持会自动降级
                return new PromptAdapter_1.PromptToolCallAdapter();
        }
    }
}
exports.ToolCallAdapterFactory = ToolCallAdapterFactory;
