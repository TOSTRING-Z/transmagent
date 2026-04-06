import { Message, ChatState } from '../types';
import { Utils } from '../utils/Utils';
export declare class ChatManager {
    messages: Message[];
    chat: ChatState;
    tagSuccess: boolean;
    uuid: string;
    utils: Utils;
    constructor(messages: Message[] | undefined, chatInitParams: Partial<ChatState> | undefined, utils: Utils);
    getUUID(): string;
    initMessages(messages?: Message[]): void;
    updateChat(): void;
    getMessages(all?: boolean): Message[];
    compressContext(messages: any): Message[];
    pushMessage(msg: Message, uuid: string): void;
    pushSystemMessage(msg: any): void;
    pushUserMessage(msg: any): void;
    pushAssistantMessageWithToolCalls(msg: any): void;
    pushAssistantMessage(msg: any): void;
    pushToolMessage(msg: any): void;
    popMessage(group_id?: string, context_id?: string): Message | null;
    getDefaultConfig(): Partial<ChatState>;
    getChatInit(params?: Partial<ChatState>): ChatState;
    fixMessages(): void;
    saveMessages(filePath: string): void;
    loadMessages(filePath: string): Message[];
    loadFromChat(chat: ChatState): boolean;
    toggleMessageGroup({ group_id, del, del_mode }: {
        group_id: string;
        del?: boolean;
        del_mode?: boolean;
    }): number;
    thumbMessageGroup({ group_id, thumb }: {
        group_id: string;
        thumb: number;
    }): any;
    toggleContextMessage({ context_id, del_mode }: {
        context_id: string;
        del_mode?: boolean;
    }): number;
    delMessage(message: Message, truncateThinking?: boolean): Message;
    getStartIdx(): number;
    getMemory(): Message[];
}
