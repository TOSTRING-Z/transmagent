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
/** mode 短名 → 显示名 映射 */
export declare const MODE_LABELS: Record<string, string>;
/** 兼容旧 isMode DSL 的 key→短名 查找表（key 为大写，如 PLAN → "plan"） */
export declare const MODE_KEYS: Record<string, string>;
export type Mode = string;
export declare class LLMBase {
    llmService: LLMService;
    window: BrowserWindow | null;
    context_id?: string;
    llmAssistant: LLMAssistant;
    utils: Utils;
    state: State;
    constructor(llmService: LLMService, window: (BrowserWindow | null) | undefined, utils: Utils);
    setUUID(data?: Record<string, any>): string;
    private formatTemplate;
    setHistory(chat?: ChatState | null): boolean | undefined;
    retry(func: (data: Record<string, any>) => Promise<any>, data: any): Promise<any>;
    llmCall(data: Record<string, any>): Promise<AssistantMessage | null>;
    sendData(data: Record<string, any>): Promise<boolean>;
    getDataDefault(cdata?: any): any;
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
