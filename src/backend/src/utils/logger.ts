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

const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

export const logger = {
    log: (...args: any[]) => {
        if (isDev) console.log('[LOG]', ...args);
    },
    warn: (...args: any[]) => {
        if (isDev) console.warn('[WARN]', ...args);
    },
    error: (...args: any[]) => {
        // 错误日志始终显示
        console.error('[ERROR]', ...args);
    },
    info: (...args: any[]) => {
        if (isDev) console.info('[INFO]', ...args);
    }
};
