import * as path from 'path';
import { logger } from '../utils/logger';


// sqlite3 和 sqlite-vec 是原生模块，保持 require 引入
const sqlite3 = require('sqlite3').verbose();

let sqliteVec: any = null;
try {
    sqliteVec = require('sqlite-vec');
} catch (e: any) {
    logger.warn("[MemoryDB] sqlite-vec module not found. Vector search will be limited.", e);
}

export interface MemoryRecord {
    chat_id: string;
    content: string;
    time: string;
    similarity: number;
}

export class MemoryDB {
    private dbPath: string;
    private db: any;

    constructor(dbPath: string | null = null) {
        this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', 'memory.db');
        this.db = null;
    }

    public async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err: Error | null) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (sqliteVec) {
                    try {
                        sqliteVec.load(this.db);
                        logger.log("[MemoryDB] sqlite-vec extension loaded.");
                    } catch (loadErr: any) {
                        console.error("[MemoryDB] Failed to load sqlite-vec:", loadErr);
                    }
                }

                try {
                    await this.createTables();
                    resolve();
                } catch (tableErr: any) {
                    reject(tableErr);
                }
            });
        });
    }

    private async createTables(): Promise<void> {
        return new Promise((resolve, reject) => {
            const sql = `
                CREATE TABLE IF NOT EXISTS memories (
                    chat_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    time TEXT NOT NULL
                );
            `;
            this.db.exec(sql, (err: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    public async add(chat_id: string, content: string, embedding: number[] | Buffer, time: string): Promise<{ chat_id: string; changes: number }> {
        return new Promise((resolve, reject) => {
            const buffer = Array.isArray(embedding)
                ? Buffer.from(new Float32Array(embedding).buffer)
                : embedding;

            const sql = `INSERT OR REPLACE INTO memories (chat_id, content, embedding, time) VALUES (?, ?, ?, ?)`;
            this.db.run(sql, [chat_id, content, buffer, time], function (this: any, err: Error | null) {
                if (err) reject(err);
                else resolve({ chat_id, changes: this.changes });
            });
        });
    }

    public async query(embedding: number[] | Buffer, top_k: number = 5): Promise<MemoryRecord[]> {
        return new Promise((resolve, reject) => {
            const queryBuffer = Array.isArray(embedding)
                ? Buffer.from(new Float32Array(embedding).buffer)
                : embedding;

            const sql = `
                SELECT chat_id, content, time, vec_distance_L2(embedding, ?) AS distance
                FROM memories
                ORDER BY distance ASC
                LIMIT ?
            `;

            this.db.all(sql, [queryBuffer, top_k], (err: Error | null, rows: any[]) => {
                if (err) {
                    console.error("[MemoryDB] Vector search error:", err);
                    reject(err);
                    return;
                }

                const results: MemoryRecord[] = rows.map(row => ({
                    chat_id: row.chat_id,
                    content: row.content,
                    time: row.time,
                    similarity: 1 / (1 + row.distance)
                }));
                resolve(results);
            });
        });
    }

    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}