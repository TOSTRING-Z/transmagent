const axios = require('axios');
const path = require('path');
const fs = require('fs');
const MemoryDB = require('./memory_db');

class MemoryManager {
    constructor(utils) {
        this.utils = utils;
        this.dbPath = path.join(this.utils.getLongMemoryPath(), 'memory.db');
        this.memoryDB = new MemoryDB(this.dbPath);
        this.initDB();
    }

    async initDB() {
        return this.memoryDB.init();
    }

    async getEmbedding(text) {
        const config = this.utils.getConfig('embedding');
        if (!config || !config.base_url || !config.api_key || !config.enabled) {
            console.log("Embedding config missing or disabled");
            return null;
        }

        try {
            const response = await axios.post(
                `${config.base_url}/embeddings`,
                {
                    input: text,
                    model: config.model || 'text-embedding-3-small'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.api_key}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data.data[0].embedding;
        } catch (error) {
            console.log("Error fetching embedding:", error.message);
            return null;
        }
    }

    async addLongTermMemory(chat_id, content, timestamp) {
        // Save as Markdown file
        try {
            // 提取年月日作为文件名部分
            const date = new Date(timestamp);
            const filename = `${chat_id}-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}.md`;
            const filePath = path.join(this.utils.getLongMemoryPath(), filename);
            // 相同文件追加内容
            fs.appendFileSync(filePath, content + '\n');
        } catch (e) {
            console.log("Failed to save memory file:", e);
        }

        const embedding = await this.getEmbedding(content);
        if (!embedding) return false;

        return this.memoryDB.add(chat_id, content, embedding, timestamp);
    }

    async queryLongTermMemory(query, top_k = 5) {
        const embedding = await this.getEmbedding(query);
        if (!embedding) return [];

        return this.memoryDB.query(embedding, top_k);
    }

    getImportantMemory() {
        const memoryPath = this.utils.getImportantMemoryPath();
        if (fs.existsSync(memoryPath)) {
            return fs.readFileSync(memoryPath, 'utf8');
        }
        return "";
    }

    appendImportantMemory(content) {
        const memoryPath = this.utils.getImportantMemoryPath();
        const dir = path.dirname(memoryPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(memoryPath, content + '\n');
        return true;
    }
}

module.exports = MemoryManager;