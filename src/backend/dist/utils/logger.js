"use strict";
/**
 * 日志工具 - 统一管理日志输出
 * 开发环境显示日志，生产环境可选择性关闭
 *
 * 使用方法：
 * 1. 在文件顶部添加: import { logger } from './logger';
 * 2. 替换 console.log -> logger.log
 * 3. 替换 console.warn -> logger.warn
 * 4. console.error 保持不变（错误始终记录）
 */
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
exports.logger = void 0;
const fs = __importStar(require("fs"));
const os_1 = require("os");
const child_process_1 = require("child_process");
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const isWin = process.platform === 'win32';
// 在 Windows 上尝试将控制台代码页切换为 UTF-8 (65001)，解决中文乱码问题
if (isWin && isDev) {
    try {
        (0, child_process_1.execSync)('chcp 65001 > nul', { stdio: 'pipe', timeout: 2000 });
    }
    catch {
        // 静默失败，不影响 Electron 打包后的运行
    }
}
/**
 * 将参数序列化为字符串，用于日志输出
 * 对于字符串原样保留，对象使用 JSON.stringify
 */
function serializeArgs(args) {
    return args.map(a => {
        if (typeof a === 'string')
            return a;
        try {
            return JSON.stringify(a);
        }
        catch {
            return String(a);
        }
    }).join(' ');
}
/**
 * 写入日志到 stdout，使用显式 UTF-8 编码
 * 在 Windows 上通过 writeSync(fd=1) 直接写入原始 UTF-8 字节，
 * 配合 chcp 65001 彻底解决控制台中文乱码问题。
 */
function writeStdout(prefix, args) {
    const message = `[${prefix}] ${serializeArgs(args)}${os_1.EOL}`;
    if (isWin) {
        // Windows: 直接写入 UTF-8 字节流到 stdout，绕过 Node.js 的编码层
        fs.writeSync(1, Buffer.from(message, 'utf-8'));
    }
    else {
        process.stdout.write(message);
    }
}
/**
 * 写入日志到 stderr，使用显式 UTF-8 编码
 */
function writeStderr(prefix, args) {
    const message = `[${prefix}] ${serializeArgs(args)}${os_1.EOL}`;
    if (isWin) {
        fs.writeSync(2, Buffer.from(message, 'utf-8'));
    }
    else {
        process.stderr.write(message);
    }
}
exports.logger = {
    log: (...args) => {
        if (isDev)
            writeStdout('LOG', args);
    },
    warn: (...args) => {
        if (isDev)
            writeStdout('WARN', args);
    },
    error: (...args) => {
        // 错误日志始终显示
        writeStderr('ERROR', args);
    },
    info: (...args) => {
        if (isDev)
            writeStdout('INFO', args);
    }
};
//# sourceMappingURL=logger.js.map