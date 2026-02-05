const sqlite3 = require('sqlite3').verbose();
const path = require('path');
let sqliteVec;
try {
    sqliteVec = require('sqlite-vec');
} catch (e) {
    console.warn("sqlite-vec module not found. Vector search functionality will be limited.", e);
}

class MemoryDB {
    constructor(dbPath = null) {
        this.dbPath = dbPath || path.join(__dirname, '../../data/memory.db');
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // 加载 sqlite-vec 扩展
                if (sqliteVec) {
                    try {
                        sqliteVec.load(this.db);
                        console.log("sqlite-vec extension loaded successfully.");
                    } catch (loadErr) {
                        console.error("Failed to load sqlite-vec extension:", loadErr);
                    }
                }

                try {
                    await this.createTables();
                    resolve();
                } catch (tableErr) {
                    reject(tableErr);
                }
            });
        });
    }

    async createTables() {
        return new Promise((resolve, reject) => {
            // 使用 BLOB 类型存储向量以兼容 sqlite-vec
            const sql = `
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp);
            `;
            this.db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async add(id, content, embedding, timestamp) {
        return new Promise((resolve, reject) => {
            // 将数组转换为 Float32Array 的 Buffer
            let buffer;
            if (Array.isArray(embedding)) {
                buffer = Buffer.from(new Float32Array(embedding).buffer);
            } else {
                // 假设已经是 Buffer 或无法处理
                buffer = embedding;
            }

            const sql = `INSERT OR REPLACE INTO memories (id, content, embedding, timestamp) VALUES (?, ?, ?, ?)`;
            this.db.run(sql, [id, content, buffer, timestamp], function(err) {
                if (err) reject(err);
                else resolve({ id: id, changes: this.changes });
            });
        });
    }

    async query(embedding, top_k = 5) {
        return new Promise((resolve, reject) => {
            // 准备查询向量
            let queryBuffer;
            if (Array.isArray(embedding)) {
                queryBuffer = Buffer.from(new Float32Array(embedding).buffer);
            } else {
                queryBuffer = embedding;
            }

            // 检查 vec_distance 是否可用 (通过简单测试或假设)
            // 如果 sqliteVec 加载成功，则使用 vec_distance
            // 否则回退到手动计算 (这里简化为假设扩展已加载，因为我们硬依赖它进行优化)
            
            const sql = `
                SELECT id, content, timestamp, vec_distance_L2(embedding, ?) AS distance
                FROM memories
                ORDER BY distance ASC
                LIMIT ?
            `;
            
            this.db.all(sql, [queryBuffer, top_k], (err, rows) => {
                if (err) {
                    // 如果出错（例如 vec_distance_L2 不存在），可能需要回退机制
                    // 但为了保持代码清晰，这里先报错
                    console.error("Vector search error (check if sqlite-vec is loaded):", err);
                    reject(err);
                    return;
                }

                const results = rows.map(row => ({
                    id: row.id,
                    content: row.content,
                    timestamp: row.timestamp,
                    // 将 L2 距离转换为相似度分数 (越小越好 -> 越大越好)
                    // 这里简单处理：similarity = 1 / (1 + distance)
                    similarity: 1 / (1 + row.distance)
                }));
                resolve(results);
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = MemoryDB;