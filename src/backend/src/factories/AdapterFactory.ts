import { ILLMAdapter,IToolCallAdapter } from '../adapters/IAdapter';
import { OpenAIAdapter,OpenAIToolCallAdapter } from '../adapters/OpenAIAdapter';
import { PromptAdapter,PromptToolCallAdapter } from '../adapters/PromptAdapter';
import { AnthropicAdapter, AnthropicToolCallAdapter } from '../adapters/AnthropicAdapter';

export class LLMAdapterFactory {
    static getAdapter(format: string): ILLMAdapter {
        switch (format) {
            case 'openai':
                return new OpenAIAdapter();
            case 'prompt':
                return new PromptAdapter();
            case 'anthropic':
                return new AnthropicAdapter();
            default:
                return new PromptAdapter(); 
        }
    }
}

export class ToolCallAdapterFactory {
    static getAdapter(format: string): IToolCallAdapter {
        switch (format) {
            case 'openai':
                return new OpenAIToolCallAdapter();
            case 'prompt':
                return new PromptToolCallAdapter();
            case 'anthropic':
                return new AnthropicToolCallAdapter();
            default:
                return new PromptToolCallAdapter(); 
        }
    }
}
