"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolCallAdapterFactory = exports.LLMAdapterFactory = void 0;
const OpenAIAdapter_1 = require("../adapters/OpenAIAdapter");
const PromptAdapter_1 = require("../adapters/PromptAdapter");
const AnthropicAdapter_1 = require("../adapters/AnthropicAdapter");
class LLMAdapterFactory {
    static getAdapter(format) {
        switch (format) {
            case 'openai':
                return new OpenAIAdapter_1.OpenAIAdapter();
            case 'prompt':
                return new PromptAdapter_1.PromptAdapter();
            case 'anthropic':
                return new AnthropicAdapter_1.AnthropicAdapter();
            default:
                return new PromptAdapter_1.PromptAdapter();
        }
    }
}
exports.LLMAdapterFactory = LLMAdapterFactory;
class ToolCallAdapterFactory {
    static getAdapter(format) {
        switch (format) {
            case 'openai':
                return new OpenAIAdapter_1.OpenAIToolCallAdapter();
            case 'prompt':
                return new PromptAdapter_1.PromptToolCallAdapter();
            case 'anthropic':
                return new AnthropicAdapter_1.AnthropicToolCallAdapter();
            default:
                return new PromptAdapter_1.PromptToolCallAdapter();
        }
    }
}
exports.ToolCallAdapterFactory = ToolCallAdapterFactory;
//# sourceMappingURL=AdapterFactory.js.map