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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
exports.logger = {
    log: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (isDev)
            console.log.apply(console, __spreadArray(['[LOG]'], args, false));
    },
    warn: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (isDev)
            console.warn.apply(console, __spreadArray(['[WARN]'], args, false));
    },
    error: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        // 错误日志始终显示
        console.error.apply(console, __spreadArray(['[ERROR]'], args, false));
    },
    info: function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (isDev)
            console.info.apply(console, __spreadArray(['[INFO]'], args, false));
    }
};
