export declare function addChatItem(chat: any): void;
export declare function newChat(chat: any): void;
export declare function selectChat(chatId: string): Promise<void>;
export declare function deleteChat(chatId: string): Promise<void>;
export declare function showHistoryMenu(event: Event, chatId: string): void;
export declare function renameChat(chatId: string): void;
export declare function confirmRename(): Promise<void>;
