import { LLMService } from './LLMService';
import { ChatState, AssistantMessage } from '../types';
import { LLMAssistant } from './LLMAssistant';
import { BrowserWindow } from 'electron/main';
import { Utils } from './Utils';
export declare enum State {
    IDLE = "idle",
    RUNNING = "running",
    PAUSE = "pause",
    FINAL = "final",
    ERROR = "error"
}
export declare enum Mode {
    AUTO = "Automatic mode",
    ACT = "Execution mode",
    PLAN = "Planning mode",
    FLASH = "Flash mode"
}
export declare class ReActAgent {
    state: State;
    llmService: LLMService;
    window: BrowserWindow | null;
    context_id?: string;
    llmAssistant: LLMAssistant;
    utils: Utils;
    constructor(llmService: LLMService, window: (BrowserWindow | null) | undefined, utils: Utils);
    setUUID(data?: Record<string, any>): string;
    private formatTemplate;
    changeWindow(window?: BrowserWindow | null): void;
    setHistory(chat?: ChatState | null): boolean | undefined;
    delHistory(id: string): void;
    renameHistory(chat: ChatState): void;
    retry(func: (data: Record<string, any>) => Promise<any>, data: any): Promise<any>;
    llmCall(data: Record<string, any>): Promise<AssistantMessage | null>;
    sendData(data: Record<string, any>): Promise<boolean>;
    getDataDefault(cdata?: any): any;
    newChat(id?: string): ChatState;
    initVar(): void;
    loadChat(id: string): ChatState;
    loadMessage(filePath: string, id?: string): void;
    getInfo(data: Record<string, any>): string;
    /**
     * 对话压缩功能（委托给 LLMAssistant）
     */
    compressionGroupMessage(params: {
        group_id: string;
    }): Promise<string | null>;
    /**
     * 聊天命名功能（委托给 LLMAssistant）
     */
    setChatName(data: Record<string, any>): Promise<void>;
}
