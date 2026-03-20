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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrompt = exports.main = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssh2_1 = require("ssh2");
const logger_1 = require("../utils/logger");
const globals_1 = require("../utils/globals");
// 更全面的工业级过滤规则
const EXCLUDE_PATTERNS = [
    // 依赖目录 (黑洞)
    /\/(node_modules|venv|\.venv|env)\//i,
    // IDE config
    /\/\.vscode\//i,
    /\/\.idea\//i,
    // Cache & Version Control
    /\/\.npm\//i,
    /\/\.git\//i,
    /\/\.next\//i, // Next.js 等框架的构建产物
];
function shouldExclude(filePath, isDir) {
    let normalized = filePath.replace(/\\/g, '/');
    if (isDir && !normalized.endsWith('/')) {
        normalized += '/';
    }
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(normalized));
}
function main(params = {}) {
    return async (args) => {
        // 适当放宽 threshold，50 有点少，100~200 配合 LLM 的上下文一般都没问题
        const threshold = params.threshold || 100;
        const regexObj = args.regex ? new RegExp(args.regex, 'i') : null; // 默认加 'i' 忽略大小写会更鲁棒
        const result = [];
        let limitReached = false;
        const sshConfig = globals_1.utils.getSshConfig ? globals_1.utils.getSshConfig() : null;
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
        // ==========================================
        // 1. 远程 SSH 遍历逻辑
        // ==========================================
        if (isRemote) {
            return new Promise((resolve) => {
                const conn = new ssh2_1.Client();
                const cleanup = () => { if (conn)
                    conn.end(); };
                conn.on('ready', () => {
                    conn.sftp(async (err, sftp) => {
                        if (err) {
                            cleanup();
                            return resolve([`SFTP Error: ${err.message}`]);
                        }
                        async function scanRemote(currentPath) {
                            if (limitReached)
                                return;
                            let items;
                            try {
                                items = await new Promise((res, rej) => {
                                    sftp.readdir(currentPath, (readErr, list) => {
                                        if (readErr)
                                            rej(readErr);
                                        else
                                            res(list);
                                    });
                                });
                            }
                            catch (e) {
                                logger_1.logger.warn(`Failed to read remote dir ${currentPath}: ${e.message}`);
                                return;
                            }
                            for (const item of items) {
                                if (limitReached)
                                    return;
                                if (item.filename === '.' || item.filename === '..')
                                    continue;
                                const fullPath = path.posix.join(currentPath, item.filename);
                                const isDir = item.attrs.isDirectory();
                                if (shouldExclude(fullPath, isDir))
                                    continue;
                                // 改为针对 fullPath 测试，支持基于路径的正则搜索
                                if (!regexObj || regexObj.test(fullPath)) {
                                    result.push(fullPath);
                                    if (result.length >= threshold) {
                                        limitReached = true;
                                        return;
                                    }
                                }
                                if (isDir && args.recursive) {
                                    await scanRemote(fullPath);
                                }
                            }
                        }
                        try {
                            const targetPath = args.path.replace(/\\/g, '/');
                            await scanRemote(targetPath);
                            cleanup();
                            // 优雅截断返回
                            if (limitReached) {
                                result.push(`... [WARNING: Output truncated. Reached maximum limit of ${threshold} items. Please use a stricter regex or avoid root directory scanning.]`);
                            }
                            resolve(result);
                        }
                        catch (error) {
                            cleanup();
                            resolve([`Remote Scan Error: ${error.message}`]);
                        }
                    });
                }).on('error', (err) => {
                    cleanup();
                    resolve([`SSH Connection Error: ${err.message}`]);
                }).connect({ ...sshConfig, readyTimeout: 20000 });
            });
        }
        // ==========================================
        // 2. 本地遍历逻辑 (改为全异步，保护事件循环)
        // ==========================================
        async function scanLocal(currentPath) {
            if (limitReached)
                return;
            let items;
            try {
                items = await fs.promises.readdir(currentPath);
            }
            catch (err) {
                logger_1.logger.warn(`Failed to read directory ${currentPath}: ${err.message}`);
                return;
            }
            for (const item of items) {
                if (limitReached)
                    return;
                const fullPath = path.join(currentPath, item);
                let stat;
                try {
                    stat = await fs.promises.stat(fullPath);
                }
                catch (e) {
                    continue;
                }
                if (shouldExclude(fullPath, stat.isDirectory()))
                    continue;
                // 同样改为针对 fullPath 测试
                if (!regexObj || regexObj.test(fullPath.replace(/\\/g, '/'))) {
                    result.push(fullPath);
                    if (result.length >= threshold) {
                        limitReached = true;
                        return;
                    }
                }
                if (stat.isDirectory() && args.recursive) {
                    await scanLocal(fullPath);
                }
            }
        }
        try {
            const targetPath = path.resolve(args.path);
            // 本地路径存在性检查 (使用异步)
            try {
                await fs.promises.access(targetPath);
            }
            catch {
                throw new Error(`Path does not exist or access denied: ${targetPath}`);
            }
            await scanLocal(targetPath);
            // 优雅截断返回
            if (limitReached) {
                result.push(`... [WARNING: Output truncated. Reached maximum limit of ${threshold} items. Please use a stricter regex or avoid root directory scanning.]`);
            }
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Error listing files in ${args.path}: ${error.message}`);
            return [error.message];
        }
    };
}
exports.main = main;
function getPrompt() {
    return {
        "name": "list_dir",
        "description": "Recursively scans directories with intelligent filtering. Automatically excludes node_modules, .git, and binary files to save tokens.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Target directory absolute path (required)."
                },
                "recursive": {
                    "type": "boolean",
                    "description": "Enable subdirectory scanning. Default is false. CAUTION: Use with care in large directories.",
                    "default": false
                },
                "regex": {
                    "type": "string",
                    "description": "Pattern to match against the FULL file path (e.g. 'src/.*\\\\.js$'). Case-insensitive by default."
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }
    };
}
exports.getPrompt = getPrompt;
//# sourceMappingURL=list_dir.js.map