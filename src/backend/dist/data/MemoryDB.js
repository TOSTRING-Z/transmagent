"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryDB = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../utils/logger");
const public_1 = require("../utils/public");
// ==================== BM25 工具函数 ====================
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0);
}
function computeBM25Score(query, document, corpus) {
    const queryTerms = tokenize(query);
    const docTerms = tokenize(document);
    if (queryTerms.length === 0 || docTerms.length === 0)
        return 0;
    const k1 = 1.5;
    const b = 0.75;
    const docLengths = corpus.map(d => tokenize(d).length);
    const avgDocLen = docLengths.reduce((a, b) => a + b, 0) / docLengths.length || 1;
    const docLen = docTerms.length;
    const termFreq = {};
    docTerms.forEach(t => { termFreq[t] = (termFreq[t] || 0) + 1; });
    const docFreq = {};
    corpus.forEach(d => {
        const terms = new Set(tokenize(d));
        terms.forEach(t => { docFreq[t] = (docFreq[t] || 0) + 1; });
    });
    const N = corpus.length || 1;
    let score = 0;
    for (const term of queryTerms) {
        const tf = termFreq[term] || 0;
        const df = docFreq[term] || 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const tfNorm = tf / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
        score += idf * tfNorm;
    }
    return score;
}
// sqlite3 和 sqlite-vec 是原生模块，保持 require 引入
const sqlite3 = require('sqlite3').verbose();
let sqliteVec = null;
try {
    sqliteVec = require('sqlite-vec');
}
catch (e) {
    logger_1.logger.warn("[MemoryDB] sqlite-vec module not found. Vector search will be limited.", e);
}
class MemoryDB {
    static instance = null;
    static initialized = false;
    dbPath;
    db;
    mdDir;
    constructor() {
        // Singleton pattern: return existing instance if already initialized
        if (MemoryDB.instance && MemoryDB.initialized) {
            this.dbPath = MemoryDB.instance.dbPath;
            this.db = MemoryDB.instance.db;
            this.mdDir = MemoryDB.instance.mdDir;
            return;
        }
        this.dbPath = (0, public_1.getDefault)('long_memory/memory.db');
        this.db = null;
        this.mdDir = (0, public_1.getDefault)('long_memory');
        MemoryDB.instance = this;
    }
    async init() {
        // Prevent multiple initializations
        if (MemoryDB.initialized && this.db) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (sqliteVec) {
                    try {
                        sqliteVec.load(this.db);
                        logger_1.logger.log("[MemoryDB] sqlite-vec extension loaded.");
                    }
                    catch (loadErr) {
                        console.error("[MemoryDB] Failed to load sqlite-vec:", loadErr);
                    }
                }
                try {
                    await this.createTables();
                    MemoryDB.initialized = true;
                    resolve();
                }
                catch (tableErr) {
                    reject(tableErr);
                }
            });
        });
    }
    async createTables() {
        return new Promise((resolve, reject) => {
            const sql = `
                CREATE TABLE IF NOT EXISTS memories (
                    chat_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    time TEXT NOT NULL
                );
            `;
            this.db.exec(sql, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    async add(chat_id, content, embedding, time) {
        return new Promise((resolve, reject) => {
            const buffer = Array.isArray(embedding)
                ? Buffer.from(new Float32Array(embedding).buffer)
                : embedding;
            const sql = `INSERT OR REPLACE INTO memories (chat_id, content, embedding, time) VALUES (?, ?, ?, ?)`;
            this.db.run(sql, [chat_id, content, buffer, time], function (err) {
                if (err)
                    reject(err);
                else
                    resolve({ chat_id, changes: this.changes });
            });
        });
    }
    async queryVector(embedding, top_k = 5) {
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
            this.db.all(sql, [queryBuffer, top_k], (err, rows) => {
                if (err) {
                    console.error("[MemoryDB] Vector search error:", err);
                    reject(err);
                    return;
                }
                const results = rows.map(row => ({
                    chat_id: row.chat_id,
                    content: row.content,
                    time: row.time,
                    similarity: 1 / (1 + row.distance)
                }));
                resolve(results);
            });
        });
    }
    async queryBM25(text, top_k = 5) {
        return new Promise((resolve, reject) => {
            const mdFiles = fs_1.default.readdirSync(this.mdDir);
            const mdContents = mdFiles.map(file => fs_1.default.readFileSync(path_1.default.join(this.mdDir, file), 'utf8'));
            const scores = mdContents.map(content => computeBM25Score(text, content, mdContents));
            const indexed = scores.map((score, index) => ({
                chat_id: mdFiles[index],
                content: mdContents[index],
                time: mdFiles[index].split('-')[0],
                similarity: score
            }));
            // 按相似度降序排列并截取 top_k
            indexed.sort((a, b) => b.similarity - a.similarity);
            resolve(indexed.slice(0, top_k));
        });
    }
    async query(embedding, query, top_k = 5) {
        // 1. 优先尝试向量搜索
        if (embedding) {
            try {
                const vectorResults = await this.queryVector(embedding, top_k);
                // 2. 若向量有结果，再用 BM25 补充并做 RRF 融合
                if (vectorResults.length > 0) {
                    const bm25Results = await this.queryBM25(query, top_k);
                    return this.fuseResults(vectorResults, bm25Results, top_k);
                }
            }
            catch (err) {
                console.warn('[MemoryDB] Vector search failed, falling back to BM25:', err.message);
            }
        }
        // 3. 向量不可用或失败时，单独使用 BM25
        return this.queryBM25(query, top_k);
    }
    /**
     * RRF (Reciprocal Rank Fusion) 融合向量与 BM25 结果
     */
    fuseResults(vectorResults, bm25Results, top_k, k = 60) {
        const scoreMap = new Map();
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
                scoreMap.get(key).score += rankScore;
            }
            else {
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
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
exports.MemoryDB = MemoryDB;
//# sourceMappingURL=MemoryDB.js.map