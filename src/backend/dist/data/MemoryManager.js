"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const MemoryDB_1 = require("./MemoryDB");
/** 内存管理类 */
class MemoryManager {
    dbPath;
    memoryDB;
    utils;
    constructor(utils) {
        this.utils = utils;
        this.dbPath = path_1.default.join(this.utils.getLongMemoryPath(), 'memory.db');
        this.memoryDB = new MemoryDB_1.MemoryDB(this.dbPath);
        // 初始化在构造函数外显式调用更为稳妥，或者在这里静默初始化
        this.initDB().catch(err => console.error("Database initialization failed:", err));
    }
    async initDB() {
        return this.memoryDB.init();
    }
    /** 获取向量嵌入 */
    async getEmbedding(text) {
        const config = this.utils.getConfig('embedding');
        if (!config?.enabled || !config.base_url || !config.api_key) {
            return null;
        }
        try {
            const { data } = await axios_1.default.post(`${config.base_url}/embeddings`, {
                input: text,
                model: config.model ?? 'text-embedding-3-small'
            }, {
                headers: {
                    'Authorization': `Bearer ${config.api_key}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000 // 增加超时保护
            });
            return data.data[0].embedding;
        }
        catch (error) {
            console.error(`Embedding Error: ${error.message}`);
            return null;
        }
    }
    /** 添加长期记忆：Markdown 文件持久化 + 向量库 */
    async addLongTermMemory(chatId, content, time) {
        try {
            // 1. 文件持久化 (异步)
            const date = time.split(' ')[0];
            const filename = `${chatId}-${date}.md`;
            const filePath = path_1.default.join(this.utils.getLongMemoryPath(), filename);
            await promises_1.default.appendFile(filePath, `${content}\n`, 'utf8');
            // 2. 向量化并入库
            const embedding = await this.getEmbedding(content);
            if (!embedding)
                return false;
            await this.memoryDB.add(chatId, content, embedding, time);
            return true;
        }
        catch (error) {
            console.error("Failed to process long-term memory:", error);
            return false;
        }
    }
    /** 查询相关记忆 */
    async queryLongTermMemory(query, topK = 5) {
        const embedding = await this.getEmbedding(query);
        if (!embedding)
            return [];
        return this.memoryDB.query(embedding, topK);
    }
    /** 获取核心/重要记忆 */
    async getImportantMemory() {
        const memoryPath = this.utils.getImportantMemoryPath();
        try {
            return await promises_1.default.readFile(memoryPath, 'utf8');
        }
        catch (e) {
            return "";
        }
    }
    /** 追加核心/重要记忆 */
    async appendImportantMemory(content, time) {
        const memoryPath = this.utils.getImportantMemoryPath();
        const dir = path_1.default.dirname(memoryPath);
        try {
            // 确保目录存在
            if (!(0, fs_1.existsSync)(dir)) {
                (0, fs_1.mkdirSync)(dir, { recursive: true });
            }
            await promises_1.default.appendFile(memoryPath, `[${time}]: ${content}\n`, 'utf8');
            return true;
        }
        catch (error) {
            console.error("Failed to append important memory:", error);
            return false;
        }
    }
}
exports.default = MemoryManager;
//# sourceMappingURL=MemoryManager.js.map