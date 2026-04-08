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
const EXCLUDE_PATTERNS = [
    /\/(node_modules|venv|\.venv|env)\//i,
    /\/\.vscode\//i,
    /\/\.idea\//i,
    /\/\.npm\//i,
    /\/\.git\//i,
    /\/\.next\//i,
];
// 优化：假设传入的已经是 normalized（POSIX风格）的路径，不再重复执行 replace
function shouldExclude(normalizedPath, isDir) {
    const checkPath = isDir && !normalizedPath.endsWith('/') ? `${normalizedPath}/` : normalizedPath;
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(checkPath));
}
function main(params = {}) {
    return async (args) => {
        const threshold = params.threshold || 150;
        const timeoutMs = params.timeoutMs || 10000;
        const toolCall = args.toolCall;
        const result = [];
        // 1. 防御非法正则表达式
        let regexObj = null;
        if (args.regex) {
            try {
                regexObj = new RegExp(args.regex, 'i');
            }
            catch (err) {
                return [`Error: Invalid regex pattern - ${err.message}`];
            }
        }
        let limitReached = false;
        let isTimedOut = false;
        let sshClient = null;
        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
        // 核心清理逻辑，确保无论如何都不泄露资源
        const cleanup = () => {
            if (sshClient) {
                sshClient.end();
                sshClient = null;
            }
        };
        // ==========================================
        // 核心扫描逻辑封装
        // ==========================================
        async function performScan() {
            if (isRemote) {
                return new Promise((resolve, reject) => {
                    sshClient = new ssh2_1.Client();
                    sshClient.on('ready', () => {
                        sshClient.sftp(async (err, sftp) => {
                            if (err)
                                return reject(new Error(`SFTP Error: ${err.message}`));
                            // 将 SFTP readdir 包装成 Promise
                            const readdirAsync = (dir) => new Promise((res, rej) => {
                                sftp.readdir(dir, (readErr, list) => readErr ? rej(readErr) : res(list));
                            });
                            async function scanRemote(currentPath) {
                                if (limitReached || isTimedOut)
                                    return;
                                let items;
                                try {
                                    items = await readdirAsync(currentPath);
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
                                    // 统一使用 posix 拼接
                                    const fullPath = path.posix.join(currentPath, item.filename);
                                    const isDir = item.attrs.isDirectory();
                                    if (item.attrs.isSymbolicLink() || shouldExclude(fullPath, isDir))
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
                                resolve();
                            }
                            catch (error) {
                                reject(error);
                            }
                        });
                    }).on('error', (err) => {
                        reject(new Error(`SSH Connection Error: ${err.message}`));
                    }).connect({ ...sshConfig, readyTimeout: 20000 });
                });
            }
            else {
                // 本地执行模式
                async function scanLocal(currentPath) {
                    if (limitReached || isTimedOut)
                        return;
                    let items;
                    try {
                        items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                    }
                    catch (err) {
                        logger_1.logger.warn(`Failed to read directory ${currentPath}: ${err.message}`);
                        return;
                    }
                    for (const item of items) {
                        if (limitReached || isTimedOut)
                            return;
                        // 本地路径统一转为 POSIX 风格以便于跨平台统一过滤和输出
                        const rawPath = path.join(currentPath, item.name);
                        const normalizedPath = rawPath.replace(/\\/g, '/');
                        const isDir = item.isDirectory();
                        if (item.isSymbolicLink() || shouldExclude(normalizedPath, isDir))
                            continue;
                        if (!regexObj || regexObj.test(normalizedPath)) {
                            result.push(normalizedPath);
                            if (result.length >= threshold) {
                                limitReached = true;
                                return;
                            }
                        }
                        if (isDir && args.recursive) {
                            await scanLocal(rawPath); // 传参给下一层用原生 path，提高兼容性
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
            }
        }
        // ==========================================
        // 调度控制：竞速执行 (Promise.race 解决 I/O 卡死)
        // ==========================================
        let watchdogObj;
        const timeoutPromise = new Promise((_, reject) => {
            watchdogObj = setTimeout(() => {
                isTimedOut = true;
                reject(new Error('TIMEOUT_GRACEFUL'));
            }, timeoutMs);
        });
        try {
            // 用 Promise.race 保证即便底层网络库死锁，也能按时脱身
            await Promise.race([performScan(), timeoutPromise]);
        }
        catch (error) {
            if (error.message !== 'TIMEOUT_GRACEFUL') {
                logger_1.logger.error(`Error listing files in ${args.path}: ${error.message}`);
                result.push(`Execution Error: ${error.message}`);
            }
        }
        finally {
            clearTimeout(watchdogObj);
            cleanup(); // 必须断开底层连接
            if (isTimedOut) {
                logger_1.logger.warn(`[ListFiles] Scan timed out after ${timeoutMs}ms for path: ${args.path}`);
                result.push(`... [WARNING: Output truncated. Scan timed out after ${timeoutMs}ms. The directory tree is too large or the storage is too slow. Please narrow your search path.]`);
            }
            else if (limitReached) {
                result.push(`... [WARNING: Output truncated. Reached maximum limit of ${threshold} items. Please use a stricter regex or avoid root directory scanning.]`);
            }
        }
        return result;
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