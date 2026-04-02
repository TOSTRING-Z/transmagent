/**
 * 通用类型定义
 * 用于替代 any 类型，提供更好的类型安全
 */
export type Callback<T = any> = (data: T) => void;
export type AsyncCallback<T = any> = (data: T) => Promise<void>;
export interface ConfigObject {
    [key: string]: any;
}
export interface DataObject {
    [key: string]: any;
}
export type AnyFunction = (...args: any[]) => any;
export type AsyncFunction = (...args: any[]) => Promise<any>;
export type AnyPromise = Promise<any>;
export interface WindowEvent {
    channel: string;
    data: any;
}
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
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
export interface FileInfo {
    path: string;
    name: string;
    size?: number;
    type?: string;
}
export interface EventHandler {
    (event: any): void;
}
