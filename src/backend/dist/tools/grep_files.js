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
const readline = __importStar(require("readline"));
const logger_1 = require("../utils/logger");
const ssh2_1 = require("ssh2");
/**
 * 封装底层的 ssh2 执行逻辑
 */
async function executeRemoteCommand(cmd, toolCall) {
    const sshConfig = toolCall.utils.getSshConfig();
    if (!sshConfig || !sshConfig.host) {
        throw new Error("Missing SSH configuration");
    }
    return new Promise((resolve, reject) => {
        const conn = new ssh2_1.Client();
        conn.on('ready', () => {
            conn.exec(cmd, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }
                let stdout = '';
                let stderr = '';
                stream.on('close', (code) => {
                    conn.end();
                    if (code > 1 && stderr && !stdout) {
                        return reject(new Error(`Remote command failed (code ${code}): ${stderr}`));
                    }
                    resolve(stdout);
                }).on('data', (data) => {
                    stdout += data.toString();
                }).stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            });
        }).on('error', (err) => {
            reject(new Error(`SSH Connection Error: ${err.message}`));
        });
        // 注入你的连接逻辑与超时设置
        conn.connect({ ...sshConfig, readyTimeout: 20000 });
    });
}
function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const BINARY_EXTENSIONS = new Set([
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv',
        '.mp3', '.wav', '.flac', '.aac', '.ogg',
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
        '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc', '.wasm'
    ]);
    if (BINARY_EXTENSIONS.has(ext))
        return false;
    const TEXT_EXTENSIONS = new Set([
        '.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.less',
        '.vue', '.svelte', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift',
        '.sql', '.sh', '.bat', '.ps1', '.yaml', '.yml', '.ini', '.env', '.xml', '.svg', '.csv', '.log', '.conf', '.toml', '.graphql'
    ]);
    if (TEXT_EXTENSIONS.has(ext))
        return true;
    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0)
                return false;
        }
        return true;
    }
    catch (error) {
        return false;
    }
    finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            }
            catch (e) { }
        }
    }
}
function main() {
    return async ({ target_files, regex, timeout_ms = 20000, toolCall }) => {
        const MAX_RESULTS = 100;
        const validFiles = target_files.filter(f => !f.includes('... (truncated'));
        if (validFiles.length === 0)
            return "Error: No valid target files provided.";
        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
        try {
            // ================= 1. SSH 远程模式 =================
            if (isRemote) {
                logger_1.logger.info(`[grep_files] Running in SSH mode against ${sshConfig.host}`);
                // 防御注入：转义单引号
                const safeRegex = regex.replace(/'/g, "'\\''");
                // 拼接目标文件列表（外层包双引号以防路径中有空格）
                const filesArg = validFiles.map(f => `"${f}"`).join(' ');
                // 使用 Linux 原生 grep
                const cmd = `grep -nHE '${safeRegex}' ${filesArg} | head -n ${MAX_RESULTS}`;
                const stdout = await executeRemoteCommand(cmd, toolCall);
                const results = [];
                if (stdout) {
                    const lines = stdout.split('\n').filter(Boolean);
                    for (const lineStr of lines) {
                        const firstColon = lineStr.indexOf(':');
                        const secondColon = lineStr.indexOf(':', firstColon + 1);
                        if (firstColon > -1 && secondColon > -1) {
                            // grep 返回的全路径就是我们传入的全路径
                            const file = lineStr.substring(0, firstColon);
                            const lineNum = parseInt(lineStr.substring(firstColon + 1, secondColon), 10);
                            const context = lineStr.substring(secondColon + 1).trim();
                            results.push({
                                file: file,
                                match: "Matched in text",
                                context: context.substring(0, 200),
                                line: lineNum || 0
                            });
                        }
                    }
                }
                return results;
            }
            // ================= 2. 本地执行模式 =================
            logger_1.logger.info(`[grep_files] Running in Local mode`);
            const startTime = Date.now();
            const results = [];
            const MAX_FILE_SIZE = 5 * 1024 * 1024;
            let regexObj;
            try {
                regexObj = new RegExp(regex, 'g');
            }
            catch (err) {
                return `Error: Invalid Regular Expression - ${err.message}`;
            }
            let globalTimeoutReached = false;
            for (const fileItem of validFiles) {
                if (globalTimeoutReached || results.length >= MAX_RESULTS)
                    break;
                // 直接使用绝对路径
                const file = path.resolve(fileItem);
                try {
                    const stat = fs.statSync(file);
                    if (!stat.isFile() || stat.size > MAX_FILE_SIZE)
                        continue;
                }
                catch (e) {
                    continue;
                }
                if (!isTextFile(file))
                    continue;
                try {
                    const fileStream = fs.createReadStream(file, { encoding: 'utf8' });
                    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
                    let currentLine = 0;
                    for await (const line of rl) {
                        currentLine++;
                        if (Date.now() - startTime > timeout_ms) {
                            globalTimeoutReached = true;
                            rl.close();
                            break;
                        }
                        regexObj.lastIndex = 0;
                        let match;
                        while ((match = regexObj.exec(line)) !== null) {
                            if (match[0].length === 0) {
                                regexObj.lastIndex++;
                                continue;
                            }
                            const start = Math.max(0, match.index - 20);
                            const end = Math.min(line.length, match.index + match[0].length + 20);
                            results.push({
                                file: file, // 直接返回文件全路径
                                match: match[0].substring(0, 150),
                                context: line.substring(start, end).trim(),
                                line: currentLine
                            });
                            if (results.length >= MAX_RESULTS) {
                                rl.close();
                                break;
                            }
                        }
                        if (results.length >= MAX_RESULTS)
                            break;
                    }
                }
                catch (e) {
                    logger_1.logger.warn(`Failed to grep ${file}`);
                }
            }
            return results;
        }
        catch (error) {
            return `Grep files error: ${error.message}`;
        }
    };
}
function getPrompt() {
    return {
        "name": "grep_files",
        "description": "Search for regex matches within a SPECIFIC list of files. Use this after using find_files. It reads the files line-by-line and returns the matches with context.",
        "parameters": {
            "type": "object",
            "properties": {
                "target_files": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "(required): Array of FULL/ABSOLUTE file paths to search inside (max 50 recommended)."
                },
                "regex": {
                    "type": "string",
                    "description": "(required): The regular expression to match."
                }
            },
            "required": ["target_files", "regex"]
        }
    };
}
//# sourceMappingURL=grep_files.js.map