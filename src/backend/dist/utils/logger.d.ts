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
export declare const logger: {
    log: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
};
