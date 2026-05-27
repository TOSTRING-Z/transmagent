import { logger } from '../utils/logger';
import { getDefault } from '../utils/public';

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
    private static initPromise: Promise<void> | null = null; // ✅ 锁住初始化过程，防止并发 init
    private dbPath: string;
    private db: any;

    constructor() {
        if (MemoryDB.instance) {
            return MemoryDB.instance;
        }
        this.dbPath = getDefault('long_memory/memory.db');
        this.db = null;
        MemoryDB.instance = this;
    }

    public async init(): Promise<void> {
        if (MemoryDB.initialized && this.db) return;
        
        // 如果有正在进行的初始化，直接等待它完成
        if (MemoryDB.initPromise) return MemoryDB.initPromise;

        MemoryDB.initPromise = new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err: Error | null) => {
                if (err) {
                    MemoryDB.initPromise = null;
                    reject(err);
                    return;
                }

                // 开启 WAL 模式：大幅提升并发读写性能
                this.db.run("PRAGMA journal_mode=WAL;");

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
                    MemoryDB.initPromise = null;
                    reject(tableErr);
                }
            });
        });

        return MemoryDB.initPromise;
    }

    private async createTables(): Promise<void> {
        return new Promise((resolve, reject) => {
            // 将建表语句分开执行，sqlite3 的 exec 执行多条语句时有时不稳定
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS memories (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, -- ✅ 显式指定自增主键
                        chat_id TEXT NOT NULL,
                        content TEXT NOT NULL,
                        embedding BLOB,
                        time TEXT NOT NULL
                    );
                `);
                this.db.run(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                        chat_id,
                        content,
                        time,
                        content='memories', -- ✅ 建立外部内容表，FTS5 不再重复存储文本实体，极大节省体积
                        content_rowid='id',
                        tokenize='unicode61'
                    );
                `, (err: Error | null) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    /**
     * 写入记忆（性能优化版：显式事务 + 内部 RowID 绑定）
     */
    public async add(chat_id: string, content: string, embedding: number[] | Buffer | null, time: string): Promise<{ chat_id: string; changes: number }> {
        return new Promise((resolve, reject) => {
            const buffer = Array.isArray(embedding)
                ? Buffer.from(new Float32Array(embedding).buffer)
                : embedding;

            // 使用 db.serialize 确保队列顺序，防止并发插入时 rowid 混乱
            this.db.serialize(() => {
                this.db.run("BEGIN IMMEDIATE TRANSACTION;"); // ✅ 开启排他性写事务

                this.db.run(
                    `INSERT INTO memories (chat_id, content, embedding, time) VALUES (?, ?, ?, ?)`,
                    [chat_id, content, buffer, time],
                    function (this: any, err: Error | null) {
                        if (err) {
                            this.db.run("ROLLBACK;");
                            reject(err);
                            return;
                        }

                        const lastId = this.lastID; // 获取当前线程安全的 rowid

                        // 写入全文检索表
                        this.db.run(
                            `INSERT INTO memories_fts (rowid, chat_id, content, time) VALUES (?, ?, ?, ?)`,
                            [lastId, chat_id, content, time],
                            function (this: any, ftsErr: Error | null) {
                                if (ftsErr) {
                                    logger.warn("[MemoryDB] FTS5 insert error:", ftsErr);
                                    // 选择性回滚：FTS 失败则整个写入失败
                                    this.db.run("ROLLBACK;");
                                    reject(ftsErr);
                                    return;
                                }

                                this.db.run("COMMIT;", (commitErr: Error | null) => {
                                    if (commitErr) {
                                        this.db.run("ROLLBACK;");
                                        reject(commitErr);
                                    } else {
                                        resolve({ chat_id, changes: 1 });
                                    }
                                });
                            }
                        );
                    }
                );
            });
        });
    }

    public async queryVector(embedding: number[] | Buffer, top_k: number = 5): Promise<MemoryRecord[]> {
        return new Promise((resolve, reject) => {
            const queryBuffer = Array.isArray(embedding)
                ? Buffer.from(new Float32Array(embedding).buffer)
                : embedding;

            // ✅ 性能优化：只查询需要的列，不盲目全表扫描
            const sql = `
                SELECT chat_id, content, time, vec_distance_L2(embedding, ?) AS distance
                FROM memories
                WHERE embedding IS NOT NULL
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
                    similarity: 1 / (1 + (row.distance || 0)) // 防御 NaN/Null
                }));
                resolve(results);
            });
        });
    }

    public async queryBM25(text: string, top_k: number = 5): Promise<MemoryRecord[]> {
        return new Promise((resolve) => {
            const sanitized = text.replace(/['"*()^~@:]/g, ' ').replace(/\s+/g, ' ').trim();
            if (!sanitized) {
                resolve([]);
                return;
            }

            // ✅ 修复隐患：标准 FTS5 MATCH 查询，ORDER BY bm25 升序（负数越小越相关）
            const sql = `
                SELECT chat_id, content, time, bm25(memories_fts) AS score
                FROM memories_fts
                WHERE memories_fts MATCH ?
                ORDER BY score ASC
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
                    similarity: Math.abs(row.score || 0)
                }));
                resolve(results);
            });
        });
    }

    public async query(embedding: number[] | Buffer | null, query: string, top_k: number = 5): Promise<MemoryRecord[]> {
        if (embedding) {
            try {
                const vectorResults = await this.queryVector(embedding, top_k);
                const bm25Results = await this.queryBM25(query, top_k);
                
                // 如果两边都有结果，进行 RRF 融合；如果只有单边有，直接返回避免降权
                if (vectorResults.length > 0 && bm25Results.length > 0) {
                    return this.fuseResults(vectorResults, bm25Results, top_k);
                } else if (vectorResults.length > 0) {
                    return vectorResults;
                }
            } catch (err: any) {
                console.warn('[MemoryDB] Vector search failed, falling back to BM25:', err.message);
            }
        }
        return this.queryBM25(query, top_k);
    }

    private fuseResults(vectorResults: MemoryRecord[], bm25Results: MemoryRecord[], top_k: number, k: number = 60): MemoryRecord[] {
        const scoreMap = new Map<string, { record: MemoryRecord; score: number }>();

        vectorResults.forEach((rec, idx) => {
            const key = `${rec.chat_id}::${rec.content}`;
            scoreMap.set(key, { record: rec, score: 1 / (k + idx + 1) });
        });

        bm25Results.forEach((rec, idx) => {
            const key = `${rec.chat_id}::${rec.content}`;
            const rankScore = 1 / (k + idx + 1);
            const exists = scoreMap.get(key);
            if (exists) {
                exists.score += rankScore;
            } else {
                scoreMap.set(key, { record: rec, score: rankScore });
            }
        });

        return Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, top_k)
            .map(item => ({
                ...item.record,
                similarity: item.score
            }));
    }

    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            MemoryDB.initialized = false;
            MemoryDB.initPromise = null;
            MemoryDB.instance = null;
        }
    }
}