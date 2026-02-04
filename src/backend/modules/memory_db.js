const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class MemoryDB {
    constructor(dbPath) {
        this.dbPath = dbPath;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    reject(err);
                    return;
                }
                db.run(`
                    CREATE TABLE IF NOT EXISTS memories (
                        id TEXT PRIMARY KEY,
                        content TEXT NOT NULL,
                        embedding BLOB NOT NULL,
                        timestamp INTEGER NOT NULL
                    )
                `, (err) => {
                    if (err) {
                        console.error('Error creating table:', err.message);
                        reject(err);
                    } else {
                        console.log('Database initialized successfully');
                        resolve({ status: 'success' });
                    }
                    db.close();
                });
            });
        });
    }

    async add(id, content, embedding, timestamp) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    reject(err);
                    return;
                }
                db.run(
                    'INSERT OR REPLACE INTO memories (id, content, embedding, timestamp) VALUES (?, ?, ?, ?)',
                    [id, content, JSON.stringify(embedding), timestamp],
                    (err) => {
                        if (err) {
                            console.error('Error inserting memory:', err.message);
                            reject(err);
                        } else {
                            resolve({ status: 'success' });
                        }
                        db.close();
                    }
                );
            });
        });
    }

    async query(embedding, top_k = 5) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    reject(err);
                    return;
                }
                db.all('SELECT id, content, embedding, timestamp FROM memories', (err, rows) => {
                    if (err) {
                        console.error('Error querying memories:', err.message);
                        reject(err);
                        db.close();
                        return;
                    }
                    const results = rows.map(row => ({
                        id: row.id,
                        content: row.content,
                        embedding: JSON.parse(row.embedding),
                        timestamp: row.timestamp
                    }));
                    const similarities = results.map(item => ({
                        ...item,
                        similarity: this.cosineSimilarity(embedding, item.embedding)
                    }));
                    similarities.sort((a, b) => b.similarity - a.similarity);
                    const topResults = similarities.slice(0, top_k).map(item => ({
                        id: item.id,
                        content: item.content,
                        similarity: item.similarity,
                        timestamp: item.timestamp
                    }));
                    resolve(topResults);
                    db.close();
                });
            });
        });
    }

    cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

module.exports = MemoryDB;