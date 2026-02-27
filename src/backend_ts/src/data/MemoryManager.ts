import axios from 'axios';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { MemoryDB } from './MemoryDB';

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
class MemoryManager {
    private readonly dbPath: string;
    private memoryDB: MemoryDB;
    private readonly utils: Utils;

    constructor(utils: Utils) {
        this.utils = utils;
        this.dbPath = path.join(this.utils.getLongMemoryPath(), 'memory.db');
        this.memoryDB = new MemoryDB(this.dbPath);
        // 初始化在构造函数外显式调用更为稳妥，或者在这里静默初始化
        this.initDB().catch(err => console.error("Database initialization failed:", err));
    }

    public async initDB(): Promise<void> {
        return this.memoryDB.init();
    }

    /** 获取向量嵌入 */
    private async getEmbedding(text: string): Promise<number[] | null> {
        const config = this.utils.getConfig('embedding');

        if (!config?.enabled || !config.base_url || !config.api_key) {
            return null;
        }

        try {
            const { data } = await axios.post(
                `${config.base_url}/embeddings`,
                {
                    input: text,
                    model: config.model ?? 'text-embedding-3-small'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.api_key}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000 // 增加超时保护
                }
            );
            return data.data[0].embedding;
        } catch (error: any) {
            console.error(`Embedding Error: ${error.message}`);
            return null;
        }
    }

    /** 添加长期记忆：Markdown 文件持久化 + 向量库 */
    public async addLongTermMemory(chatId: string, content: string, time: string): Promise<boolean> {
        try {
            // 1. 文件持久化 (异步)
            const date = time.split(' ')[0];
            const filename = `${chatId}-${date}.md`;
            const filePath = path.join(this.utils.getLongMemoryPath(), filename);

            await fs.appendFile(filePath, `${content}\n`, 'utf8');

            // 2. 向量化并入库
            const embedding = await this.getEmbedding(content);
            if (!embedding) return false;

            await this.memoryDB.add(chatId, content, embedding, time);
            return true;
        } catch (error) {
            console.error("Failed to process long-term memory:", error);
            return false;
        }
    }

    /** 查询相关记忆 */
    public async queryLongTermMemory(query: string, topK: number = 5): Promise<any[]> {
        const embedding = await this.getEmbedding(query);
        if (!embedding) return [];

        return this.memoryDB.query(embedding, topK);
    }

    /** 获取核心/重要记忆 */
    public async getImportantMemory(): Promise<string> {
        const memoryPath = this.utils.getImportantMemoryPath();
        try {
            return await fs.readFile(memoryPath, 'utf8');
        } catch {
            return "";
        }
    }

    /** 追加核心/重要记忆 */
    public async appendImportantMemory(content: string, time: string): Promise<boolean> {
        const memoryPath = this.utils.getImportantMemoryPath();
        const dir = path.dirname(memoryPath);

        try {
            // 确保目录存在
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            await fs.appendFile(memoryPath, `[${time}]: ${content}\n`, 'utf8');
            return true;
        } catch (error) {
            console.error("Failed to append important memory:", error);
            return false;
        }
    }
}

export default MemoryManager;