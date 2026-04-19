"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryDB = void 0;
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
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
    constructor(dbPath = null) {
        // Singleton pattern: return existing instance if already initialized
        if (MemoryDB.instance && MemoryDB.initialized) {
            this.dbPath = MemoryDB.instance.dbPath;
            this.db = MemoryDB.instance.db;
            return;
        }
        this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', 'memory.db');
        this.db = null;
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
    async query(embedding, top_k = 5) {
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
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
exports.MemoryDB = MemoryDB;
//# sourceMappingURL=MemoryDB.js.map