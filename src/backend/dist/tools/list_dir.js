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
exports.main = main;
exports.getPrompt = getPrompt;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssh2_1 = require("ssh2");
const logger_1 = require("../utils/logger");
const WindowManager_1 = require("../main/windows/WindowManager");
// 工业级过滤规则
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
        // 配置默认值：阈值 150 条，超时 10 秒
        const threshold = params.threshold || 150;
        const timeoutMs = params.timeoutMs || 10000;
        const regexObj = args.regex ? new RegExp(args.regex, 'i') : null;
        const result = [];
        let limitReached = false;
        let isTimedOut = false;
        const sshConfig = WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig ? WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig() : null;
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
        // ==========================================
        // 全局超时守护 (Watchdog)
        // ==========================================
        const watchdog = setTimeout(() => {
            isTimedOut = true;
            logger_1.logger.warn(`[ListFiles] Scan timed out after ${timeoutMs}ms for path: ${args.path}`);
        }, timeoutMs);
        try {
            // ==========================================
            // 1. 远程 SSH 遍历逻辑
            // ==========================================
            if (isRemote) {
                return await new Promise((resolve) => {
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
                                // 检查中断信号
                                if (limitReached || isTimedOut)
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
                                    if (limitReached || isTimedOut)
                                        return;
                                    if (item.filename === '.' || item.filename === '..')
                                        continue;
                                    const fullPath = path.posix.join(currentPath, item.filename);
                                    const isDir = item.attrs.isDirectory();
                                    const isSymlink = item.attrs.isSymbolicLink();
                                    // 过滤软链接防止死循环，过滤黑名单
                                    if (isSymlink || shouldExclude(fullPath, isDir))
                                        continue;
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
                            }
                            catch (error) {
                                result.push(`Remote Scan Error: ${error.message}`);
                            }
                            finally {
                                cleanup();
                                resolve(result); // 统一在底部包装截断信息
                            }
                        });
                    }).on('error', (err) => {
                        cleanup();
                        resolve([`SSH Connection Error: ${err.message}`]);
                    }).connect({ ...sshConfig, readyTimeout: 20000 });
                });
            }
            // ==========================================
            // 2. 本地遍历逻辑
            // ==========================================
            async function scanLocal(currentPath) {
                if (limitReached || isTimedOut)
                    return;
                let items;
                try {
                    // 使用 withFileTypes 极大提升本地 IO 性能，减少 stat 调用
                    items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                }
                catch (err) {
                    logger_1.logger.warn(`Failed to read directory ${currentPath}: ${err.message}`);
                    return;
                }
                for (const item of items) {
                    if (limitReached || isTimedOut)
                        return;
                    const fullPath = path.join(currentPath, item.name);
                    const isDir = item.isDirectory();
                    const isSymlink = item.isSymbolicLink();
                    // 过滤软链接防死循环，过滤黑名单
                    if (isSymlink || shouldExclude(fullPath, isDir))
                        continue;
                    const normalizedPath = fullPath.replace(/\\/g, '/');
                    if (!regexObj || regexObj.test(normalizedPath)) {
                        result.push(fullPath);
                        if (result.length >= threshold) {
                            limitReached = true;
                            return;
                        }
                    }
                    if (isDir && args.recursive) {
                        await scanLocal(fullPath);
                    }
                }
            }
            const targetPath = path.resolve(args.path);
            try {
                await fs.promises.access(targetPath);
            }
            catch {
                throw new Error(`Path does not exist or access denied: ${targetPath}`);
            }
            await scanLocal(targetPath);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Error listing files in ${args.path}: ${error.message}`);
            return [error.message];
        }
        finally {
            // ==========================================
            // 3. 统一清理与截断信息注入
            // ==========================================
            clearTimeout(watchdog); // 必须清理定时器防止内存/句柄泄漏
            if (isTimedOut) {
                result.push(`... [WARNING: Output truncated. Scan timed out after ${timeoutMs}ms. The directory tree is too large or the storage is too slow. Please narrow your search path.]`);
            }
            else if (limitReached) {
                result.push(`... [WARNING: Output truncated. Reached maximum limit of ${threshold} items. Please use a stricter regex or avoid root directory scanning.]`);
            }
        }
    };
}
function getPrompt() {
    return {
        "name": "list_dir",
        "description": "Recursively scans directories with intelligent filtering. Automatically excludes node_modules, .git, and binary files. Has a built-in execution timeout and item limit to prevent overwhelming the context.",
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
                    "description": "Pattern to match against the FULL file path (e.g., '\\\\.ts$' or 'src/.*\\\\.js$'). Case-insensitive by default."
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }
    };
}
//# sourceMappingURL=list_dir.js.map