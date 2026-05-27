import { logger } from '../utils/logger';
import { getDefault } from '../utils/public';

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
    private static instance: MemoryDB | null = null;
    private static initialized: boolean = false;
    private dbPath: string;
    private db: any;

    constructor() {
        // Singleton pattern: return existing instance if already initialized
        if (MemoryDB.instance && MemoryDB.initialized) {
            this.dbPath = MemoryDB.instance.dbPath;
            this.db = MemoryDB.instance.db;
            return;
        }
        this.dbPath = getDefault('long_memory/memory.db');
        this.db = null;
        MemoryDB.instance = this;
    }

    public async init(): Promise<void> {
        // Prevent multiple initializations
        if (MemoryDB.initialized && this.db) {
            return Promise.resolve();
        }

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
                    MemoryDB.initialized = true;
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
                    embedding BLOB,
                    time TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                    chat_id,
                    content,
                    time,
                    tokenize='unicode61'
                );
            `;
            this.db.exec(sql, (err: Error | null) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * 写入记忆（向量 + FTS5 全文索引，rowid 对齐）
     * embedding 为 null 时只写 FTS5，不写向量
     */
    public async add(chat_id: string, content: string, embedding: number[] | Buffer | null, time: string): Promise<{ chat_id: string; changes: number }> {
        return new Promise((resolve, reject) => {
            const buffer = embedding
                ? (Array.isArray(embedding) ? Buffer.from(new Float32Array(embedding).buffer) : embedding)
                : null;

            const sql = `INSERT INTO memories (chat_id, content, embedding, time) VALUES (?, ?, ?, ?)`;
            this.db.run(sql, [chat_id, content, buffer, time], function (this: any, err: Error | null) {
                if (err) {
                    reject(err);
                    return;
                }

                const rowid = this.lastID;

                // 用相同 rowid 写入 FTS5，保证两表对齐
                this.db.run(
                    `INSERT INTO memories_fts (rowid, chat_id, content, time) VALUES (?, ?, ?, ?)`,
                    [rowid, chat_id, content, time],
                    (ftsErr: Error | null) => {
                        if (ftsErr) {
                            logger.warn("[MemoryDB] FTS5 insert error:", ftsErr);
                        }
                    }
                );

                resolve({ chat_id, changes: this.changes });
            });
        });
    }

    public async queryVector(embedding: number[] | Buffer, top_k: number = 5): Promise<MemoryRecord[]> {
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

    /**
     * BM25 全文检索 — 基于 SQLite FTS5 引擎
     * FTS5 的 bm25() 返回负值（越小越相关），取绝对值后用于 RRF 融合
     */
    public async queryBM25(text: string, top_k: number = 5): Promise<MemoryRecord[]> {
        return new Promise((resolve) => {
            // 去除 FTS5 MATCH 语法中的特殊字符，防止查询报错
            const sanitized = text.replace(/['"*()^~@:]/g, ' ').replace(/\s+/g, ' ').trim();

            if (!sanitized) {
                resolve([]);
                return;
            }

            const sql = `
                SELECT chat_id, content, time, bm25(memories_fts) AS score
                FROM memories_fts
                WHERE memories_fts MATCH ?
                ORDER BY score
                LIMIT ?
            `;

            this.db.all(sql, [sanitized, top_k], (err: Error | null, rows: any[]) => {
                if (err) {
                    logger.warn("[MemoryDB] FTS5 search error:", err);
                    resolve([]);
                    return;
                }

                const results: MemoryRecord[] = rows.map(row => ({
                    chat_id: row.chat_id,
                    content: row.content,
                    time: row.time,
                    similarity: Math.abs(row.score)
                }));
                resolve(results);
            });
        });
    }

    public async query(embedding: number[] | Buffer | null, query: string, top_k: number = 5): Promise<MemoryRecord[]> {
        // 1. 优先尝试向量搜索
        if (embedding) {
            try {
                const vectorResults = await this.queryVector(embedding, top_k);
                // 2. 若向量有结果，再用 BM25 补充并做 RRF 融合
                if (vectorResults.length > 0) {
                    const bm25Results = await this.queryBM25(query, top_k);
                    return this.fuseResults(vectorResults, bm25Results, top_k);
                }
            } catch (err: any) {
                console.warn('[MemoryDB] Vector search failed, falling back to BM25:', err.message);
            }
        }
        // 3. 向量不可用或失败时，单独使用 BM25
        return this.queryBM25(query, top_k);
    }

    /**
     * RRF (Reciprocal Rank Fusion) 融合向量与 BM25 结果
     */
    private fuseResults(
        vectorResults: MemoryRecord[],
        bm25Results: MemoryRecord[],
        top_k: number,
        k: number = 60
    ): MemoryRecord[] {
        const scoreMap = new Map<string, { record: MemoryRecord; score: number }>();

        // 向量结果按排名打分
        vectorResults.forEach((rec, idx) => {
            const key = `${rec.chat_id}::${rec.content}`;
            const rankScore = 1 / (k + idx + 1);
            scoreMap.set(key, { record: rec, score: rankScore });
        });

        // BM25 结果按排名打分并累加
        bm25Results.forEach((rec, idx) => {
            const key = `${rec.chat_id}::${rec.content}`;
            const rankScore = 1 / (k + idx + 1);
            if (scoreMap.has(key)) {
                scoreMap.get(key)!.score += rankScore;
            } else {
                scoreMap.set(key, { record: rec, score: rankScore });
            }
        });

        // 按融合分数降序排列
        const fused = Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, top_k)
            .map(item => ({
                ...item.record,
                similarity: item.score
            }));

        return fused;
    }

    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
