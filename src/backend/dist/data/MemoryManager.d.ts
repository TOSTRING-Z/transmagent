/** 内存管理类 */
declare class MemoryManager {
    private memoryDB;
    constructor();
    initDB(): Promise<void>;
    /** 获取向量嵌入 */
    private getEmbedding;
    /** 添加长期记忆：Markdown 文件持久化 + 向量库 */
    addLongTermMemory(chatId: string, content: string, time: string): Promise<boolean>;
    /** 查询相关记忆 */
    queryLongTermMemory(query: string, topK?: number): Promise<any[]>;
    /** 获取核心/重要记忆 */
    getImportantMemory(): Promise<string>;
    /** 追加核心/重要记忆 */
    appendImportantMemory(content: string, time: string): Promise<boolean>;
}
export default MemoryManager;
