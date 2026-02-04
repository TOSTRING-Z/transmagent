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
        if (!config || !config.base_url || !config.api_key) {
            console.error("Embedding config missing");
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
            console.error("Error fetching embedding:", error.message);
            return null;
        }
    }

    async addLongTermMemory(id, content, timestamp) {
        // Save as Markdown file
        try {
            const filename = `${id}-${timestamp}.md`;
            const filePath = path.join(this.utils.getLongMemoryPath(), filename);
            fs.writeFileSync(filePath, content, 'utf8');
        } catch (e) {
            console.error("Failed to save memory file:", e);
        }

        const embedding = await this.getEmbedding(content);
        if (!embedding) return false;

        return this.memoryDB.add(id, content, embedding, timestamp);
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