import type { MainWindow } from '../main/windows/MainWindow';
interface CompletionsRequest {
    messages: Array<{
        role: string;
        content: string;
    }>;
    max_step?: number;
}
interface CheckoutRequest {
    chat_id?: string;
    chat_name?: string;
}
interface ModeRequest {
    mode?: string;
}
interface ServerResult<T = any> {
    error?: string;
    [key: string]: T | string | undefined;
}
export declare class MainServer {
    private mainWindow;
    constructor(mainWindow: MainWindow);
    completions(data: CompletionsRequest): Promise<ServerResult>;
    mode(data: ModeRequest): Promise<ServerResult>;
    list(): Promise<ServerResult>;
    checkout(data: CheckoutRequest): Promise<ServerResult>;
}
export {};
