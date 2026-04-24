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
    private mdDir;
    constructor();
    init(): Promise<void>;
    private createTables;
    add(chat_id: string, content: string, embedding: number[] | Buffer, time: string): Promise<{
        chat_id: string;
        changes: number;
    }>;
    queryVector(embedding: number[] | Buffer, top_k?: number): Promise<MemoryRecord[]>;
    queryBM25(text: string, top_k?: number): Promise<MemoryRecord[]>;
    query(embedding: number[] | Buffer | null, query: string, top_k?: number): Promise<MemoryRecord[]>;
    /**
     * RRF (Reciprocal Rank Fusion) 融合向量与 BM25 结果
     */
    private fuseResults;
    close(): void;
}
