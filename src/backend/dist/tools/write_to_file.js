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
const globals_1 = require("../utils/globals");
// 本地文件操作
async function writeLocalFile(filePath, content, mode) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (mode === 'append' && fs.existsSync(filePath)) {
        await fs.promises.appendFile(filePath, content, 'utf8');
    }
    else {
        await fs.promises.writeFile(filePath, content, 'utf8');
    }
}
// 远程SSH文件操作
async function writeRemoteFile(filePath, content, mode, sshConfig) {
    return new Promise((resolve, reject) => {
        const conn = new ssh2_1.Client();
        conn.on('ready', () => {
            // 1. 强制在远端创建父级目录
            const dirName = path.posix.dirname(filePath);
            conn.exec(`mkdir -p "${dirName}"`, (execErr, stream) => {
                if (execErr) {
                    conn.end();
                    return reject(new Error(`Failed to create remote directory: ${execErr.message}`));
                }
                stream.on('close', () => {
                    // 2. 目录创建完毕，开启 SFTP
                    conn.sftp((err, sftp) => {
                        if (err) {
                            conn.end();
                            return reject(new Error(`SFTP error: ${err.message}`));
                        }
                        // 3. 使用原生 flag 处理覆盖与追加
                        const writeOptions = mode === 'append' ? { encoding: 'utf8', flag: 'a' } : { encoding: 'utf8', flag: 'w' };
                        sftp.writeFile(filePath, content, writeOptions, (writeErr) => {
                            conn.end();
                            if (writeErr)
                                reject(new Error(`Remote write error: ${writeErr.message}`));
                            else
                                resolve();
                        });
                    });
                }).on('data', () => { }).stderr.on('data', () => { });
            });
        }).on('error', (err) => {
            reject(new Error(`SSH connection error: ${err.message}`));
        }).connect({ ...sshConfig, readyTimeout: 20000 });
    });
}
// --- 主执行逻辑 ---
function main() {
    return async (params) => {
        try {
            const { file_path, content = '', mode = 'overwrite' } = params;
            if (!file_path) {
                throw new Error("file_path is required");
            }
            const sshConfig = globals_1.utils?.getSshConfig ? globals_1.utils.getSshConfig() : null;
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
            if (isRemote) {
                await writeRemoteFile(file_path, content, mode, sshConfig);
            }
            else {
                await writeLocalFile(file_path, content, mode);
            }
            return `File ${file_path} saved successfully (mode: ${mode}).`;
        }
        catch (error) {
            return `File save failed: ${error.message}`;
        }
    };
}
// --- 大模型 Prompt 提示词 ---
function getPrompt() {
    return {
        "name": "write_to_file",
        "description": `Writes text content to a local or remote file.

Write Modes:
1. **overwrite** (default): Replaces the entire file with the new content. Used for creating new files or fully rewriting existing ones.
2. **append**: Adds the content to the very end of an existing file. Perfect for adding new lines, logs, or continuing a file that was too long to write in one go due to length limits.

CRITICAL PIPELINE RULES:
- If your script/file is extremely long and gets cut off, simply call this tool again with mode='append' to continue writing the rest of the content.
- If you are making partial, surgical edits to the middle of an existing file, DO NOT use this tool. Use the 'replace_in_file' tool instead to avoid wiping out existing code.`,
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute or relative destination path. Missing parent directories are created automatically."
                },
                "content": {
                    "type": "string",
                    "description": "The text content to write or append."
                },
                "mode": {
                    "type": "string",
                    "description": "Write mode: 'overwrite' or 'append'.",
                    "enum": ["overwrite", "append"],
                    "default": "overwrite"
                }
            },
            "required": ["file_path"],
            "additionalProperties": false
        }
    };
}
//# sourceMappingURL=write_to_file.js.map