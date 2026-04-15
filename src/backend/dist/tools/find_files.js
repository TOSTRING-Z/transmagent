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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ssh2_1 = require("ssh2");
const logger_1 = require("../utils/logger");
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
                stream.on('close', (code, signal) => {
                    conn.end();
                    // grep/find 未找到结果时可能会返回代码 1，不能仅凭代码非 0 就抛错。
                    // 只有当存在严重错误码 (>1) 且有报错输出时才拦截
                    if (code > 1 && stderr && !stdout) {
                        return reject(new Error(`Remote command failed (code ${code}): ${stderr}`));
                    }
                    // 无论 code 是 0 还是 1，只要走完了，就把收到的标准输出返回
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
function main() {
    return async ({ dir_path, file_pattern, toolCall }) => {
        const MAX_FILES = 200;
        const sshConfig = toolCall.utils.getSshConfig();
        const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
        try {
            // ================= 1. SSH 远程模式 =================
            if (isRemote) {
                logger_1.logger.info(`[find_files] Running in SSH mode against ${sshConfig.host}`);
                // 将形如 **/*.ts 的 glob 转换为 find 命令的 -name "*.ts"
                const namePattern = file_pattern.replace(/\*\*\//g, '');
                const cmd = `find "${dir_path}" -type f -name "${namePattern}" | head -n ${MAX_FILES + 1}`;
                const stdout = await executeRemoteCommand(cmd, toolCall);
                let files = stdout.split('\n').map(f => f.trim()).filter(Boolean);
                if (files.length > MAX_FILES) {
                    files = files.slice(0, MAX_FILES);
                    files.push(`... (truncated, more files hidden)`);
                }
                return files;
            }
            // ================= 2. 本地执行模式 =================
            logger_1.logger.info(`[find_files] Running in Local mode`);
            const resolvedTarget = path.resolve(dir_path);
            const stats = fs.statSync(resolvedTarget);
            if (!stats.isDirectory()) {
                throw new Error(`Target must be a directory: ${resolvedTarget}`);
            }
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const globModule = require('glob');
            const globOptions = { cwd: resolvedTarget, nodir: true, absolute: false };
            let files = [];
            if (typeof globModule.globSync === 'function') {
                files = globModule.globSync(file_pattern, globOptions);
            }
            else if (typeof globModule.sync === 'function') {
                files = globModule.sync(file_pattern, globOptions);
            }
            else {
                files = await globModule(file_pattern, globOptions);
            }
            if (files.length > MAX_FILES) {
                files = files.slice(0, MAX_FILES);
                files.push(`... (truncated, ${files.length - MAX_FILES} more files hidden)`);
            }
            return files;
        }
        catch (error) {
            logger_1.logger.error(`Find files error: ${error.message}`);
            return `Error: ${error.message}`;
        }
    };
}
function getPrompt() {
    return {
        "name": "find_files",
        "description": "Find file paths in a directory using a glob pattern. Use this to explore directory structures or find specific files before reading them. Returns up to 200 relative paths.",
        "parameters": {
            "type": "object",
            "properties": {
                "dir_path": {
                    "type": "string",
                    "description": "(required): starting directory path, absolute or relative"
                },
                "file_pattern": {
                    "type": "string",
                    "description": "(required): glob pattern. Examples: \"**/*\" (all files), \"src/**/*.ts\", \"*.env\""
                }
            },
            "required": ["dir_path", "file_pattern"]
        }
    };
}
//# sourceMappingURL=find_files.js.map