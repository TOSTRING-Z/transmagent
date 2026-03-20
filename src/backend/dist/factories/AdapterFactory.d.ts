import { ILLMAdapter, IToolCallAdapter } from '../adapters/IAdapter';
export declare class LLMAdapterFactory {
    static getAdapter(format: string): ILLMAdapter;
}
export declare class ToolCallAdapterFactory {
    static getAdapter(format: string): IToolCallAdapter;
}
