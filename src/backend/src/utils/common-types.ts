/**
 * 通用类型定义
 * 用于替代 any 类型，提供更好的类型安全
 */

// 通用回调函数类型
export type Callback<T = any> = (data: T) => void;
export type AsyncCallback<T = any> = (data: T) => Promise<void>;

// 通用配置对象
export interface ConfigObject {
    [key: string]: any;
}

// 通用数据对象
export interface DataObject {
    [key: string]: any;
}

// 函数类型
export type AnyFunction = (...args: any[]) => any;
export type AsyncFunction = (...args: any[]) => Promise<any>;

// Promise 类型
export type AnyPromise = Promise<any>;

// 窗口相关的通用类型
export interface WindowEvent {
    channel: string;
    data: any;
}

// 聊天相关类型
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    [key: string]: any;
}

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
}

// API 响应类型
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

// 文件操作类型
export interface FileInfo {
    path: string;
    name: string;
    size?: number;
    type?: string;
}

// 事件处理器
export interface EventHandler {
    (event: any): void;
}
