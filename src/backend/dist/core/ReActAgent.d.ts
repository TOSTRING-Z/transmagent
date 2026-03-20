import { LLMService } from './LLMService';
import { Message, ChatState } from '../types';
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
    llm_service: LLMService;
    window: any;
    alertWindow: any;
    context_id?: string;
    constructor(llm_service: LLMService, window?: any, alertWindow?: any);
    private formatTemplate;
    changeWindow(window?: any): void;
    setHistory(chat?: ChatState | null): boolean | undefined;
    delHistory(id: string): void;
    renameHistory(chat: ChatState): void;
    retry(func: (data: Record<string, any>) => Promise<any>, data: any): Promise<any>;
    llmCall(data: Record<string, any>): Promise<Message | null>;
    sendData(data: Record<string, any>): Promise<boolean>;
    getDataDefault(cdata?: any): any;
    compressionGroupMessage({ group_id }: {
        group_id: string;
    }): Promise<string | null>;
    setChatName(_data: any): Promise<void>;
    newChat(): ChatState;
    initVar(): void;
    loadChat(id: string): ChatState;
    loadMessage(filePath: string): void;
    getInfo(data: Record<string, any>): string;
}
