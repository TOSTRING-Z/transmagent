import { AgentMode } from '../types';
export declare class Utils {
    agentMode: AgentMode;
    constructor(agentMode: AgentMode);
    hashCode(str: string): string;
    sendData(base: string, data: any): Promise<any>;
    extractJson(text: string): string | null;
    parseJsonContent(content: string): any;
    delay(seconds: number): Promise<void>;
    getDefault(name?: string): string;
    getSystem(name?: string): string;
    getFile(file_path: string): string | null;
    setFile(content: string, file_path?: string | null): boolean;
    getConfig(key?: string | null, config_name?: string | null): any;
    setConfig(config: any): boolean;
    getSshConfig(): any;
    mergeConfigEnhanced(defaultConfig: any, userConfig: any): {
        mergedConfig: any;
        mismatches: any[];
        addedKeys: any[];
    };
    getLanguage(): string;
    formatDate(): string;
    copy<T>(data: T): T;
    getHistoryData(): any;
    deleteFile(filePath: string): boolean;
    setHistoryData(historyData: any): boolean;
    getHistoryConfigPath(): string;
    getHistoryPath(id: string): string;
    getImportantMemoryPath(): string;
    getLongMemoryPath(): string;
}
