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

import * as fs from 'fs';
import { EOL } from 'os';
import { execSync } from 'child_process';

const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const isWin = process.platform === 'win32';

// 在 Windows 上尝试将控制台代码页切换为 UTF-8 (65001)，解决中文乱码问题
if (isWin && isDev) {
    try {
        execSync('chcp 65001 > nul', { stdio: 'pipe', timeout: 2000 });
    } catch {
        // 静默失败，不影响 Electron 打包后的运行
    }
}

/**
 * 将参数序列化为字符串，用于日志输出
 * 对于字符串原样保留，对象使用 JSON.stringify
 */
function serializeArgs(args: any[]): string {
    return args.map(a => {
        if (typeof a === 'string') return a;
        try {
            return JSON.stringify(a);
        } catch {
            return String(a);
        }
    }).join(' ');
}

/**
 * 写入日志到 stdout，使用显式 UTF-8 编码
 * 在 Windows 上通过 writeSync(fd=1) 直接写入原始 UTF-8 字节，
 * 配合 chcp 65001 彻底解决控制台中文乱码问题。
 */
function writeStdout(prefix: string, args: any[]): void {
    const message = `[${prefix}] ${serializeArgs(args)}${EOL}`;
    if (isWin) {
        // Windows: 直接写入 UTF-8 字节流到 stdout，绕过 Node.js 的编码层
        fs.writeSync(1, Buffer.from(message, 'utf-8'));
    } else {
        process.stdout.write(message);
    }
}

/**
 * 写入日志到 stderr，使用显式 UTF-8 编码
 */
function writeStderr(prefix: string, args: any[]): void {
    const message = `[${prefix}] ${serializeArgs(args)}${EOL}`;
    if (isWin) {
        fs.writeSync(2, Buffer.from(message, 'utf-8'));
    } else {
        process.stderr.write(message);
    }
}

export const logger = {
    log: (...args: any[]) => {
        if (isDev) writeStdout('LOG', args);
    },
    warn: (...args: any[]) => {
        if (isDev) writeStdout('WARN', args);
    },
    error: (...args: any[]) => {
        // 错误日志始终显示
        writeStderr('ERROR', args);
    },
    info: (...args: any[]) => {
        if (isDev) writeStdout('INFO', args);
    }
};
