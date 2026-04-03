import { ChatManager } from './ChatManager';
import { ILLMAdapter } from '../adapters/IAdapter';
import { ChatRequestData, Message } from '../types';
import { BrowserWindow } from 'electron';
export declare class LLMService {
    private window;
    chatManager: ChatManager;
    stopFlag: boolean;
    adapter: ILLMAdapter;
    constructor(messages?: Message[], window?: BrowserWindow | null);
    stopLoop(): void;
    startLoop(): void;
    chatBase(data: ChatRequestData): Promise<Message | null>;
    private handleStream;
    private handleNormal;
}
