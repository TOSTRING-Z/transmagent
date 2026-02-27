import { ILLMAdapter } from '../adapters/IAdapter';
import { OpenAIAdapter } from '../adapters/OpenAIAdapter';
import { PromptAdapter } from '../adapters/PromptAdapter';

export class AdapterFactory {
    static getAdapter(format: string): ILLMAdapter {
        switch (format) {
            case 'openai':
                return new OpenAIAdapter();
            case 'prompt':
                return new PromptAdapter();
            default:
                return new PromptAdapter(); 
        }
    }
}