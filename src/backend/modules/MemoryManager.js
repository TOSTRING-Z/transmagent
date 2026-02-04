const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class MemoryManager {
    constructor(utils) {
        this.utils = utils;
        this.pythonScriptPath = path.join(__dirname, '../scripts/memory_db.py');
        this.dbPath = path.join(this.utils.getLongMemoryPath(), 'memory.db');
        this.initDB();
    }

    async initDB() {
        return this.runPythonScript({ action: 'init', db_path: this.dbPath });
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

    runPythonScript(command) {
        return new Promise((resolve, reject) => {
            const pyProcess = spawn('python3', [this.pythonScriptPath]);
            let output = '';
            let errorOutput = '';

            pyProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            pyProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            pyProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python script error: ${errorOutput}`);
                    resolve(null);
                } else {
                    try {
                        resolve(JSON.parse(output));
                    } catch (e) {
                        console.error("Error parsing Python output", output);
                        resolve(null);
                    }
                }
            });

            pyProcess.stdin.write(JSON.stringify(command));
            pyProcess.stdin.end();
        });
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

        const result = await this.runPythonScript({
            action: 'add',
            db_path: this.dbPath,
            id,
            content,
            embedding,
            timestamp
        });
        return result && result.status === 'success';
    }

    async queryLongTermMemory(query, top_k = 5) {
        const embedding = await this.getEmbedding(query);
        if (!embedding) return [];

        const results = await this.runPythonScript({
            action: 'query',
            db_path: this.dbPath,
            embedding,
            top_k
        });
        return results || [];
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