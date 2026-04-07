import { ChatManager } from './ChatManager';
import { ILLMAdapter } from '../adapters/IAdapter';
import { AgentMode, ChatRequestData, Message } from '../types';
import { BrowserWindow } from 'electron';
import { Utils } from './Utils';
export declare class LLMService {
    window: BrowserWindow | null;
    chatManager: ChatManager;
    stopFlag: boolean;
    adapter: ILLMAdapter;
    utils: Utils;
    environment_details: any;
    constructor(messages: Message[] | undefined, window: (BrowserWindow | null) | undefined, utils: Utils, agentMode?: AgentMode);
    stopLoop(): void;
    startLoop(): void;
    chatBase(data: ChatRequestData): Promise<Message | null>;
    private handleStream;
    private handleNormal;
}
