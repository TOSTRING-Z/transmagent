/** 配置接口定义 */
interface EmbeddingConfig {
    base_url: string;
    api_key: string;
    enabled: boolean;
    model?: string;
}
interface Utils {
    getLongMemoryPath(): string;
    getImportantMemoryPath(): string;
    getConfig(key: 'embedding'): EmbeddingConfig | undefined;
}
/** 内存管理类 */
declare class MemoryManager {
    private readonly dbPath;
    private memoryDB;
    private readonly utils;
    constructor(utils: Utils);
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
