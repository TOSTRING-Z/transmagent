export interface MemoryRecord {
    chat_id: string;
    content: string;
    time: string;
    similarity: number;
}
export declare class MemoryDB {
    private static instance;
    private static initialized;
    private dbPath;
    private db;
    constructor(dbPath?: string | null);
    init(): Promise<void>;
    private createTables;
    add(chat_id: string, content: string, embedding: number[] | Buffer, time: string): Promise<{
        chat_id: string;
        changes: number;
    }>;
    query(embedding: number[] | Buffer, top_k?: number): Promise<MemoryRecord[]>;
    close(): void;
}
