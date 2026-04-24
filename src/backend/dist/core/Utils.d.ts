import { AgentMode } from '../types';
export declare class Utils {
    agentMode: AgentMode;
    constructor(agentMode: AgentMode);
    sendData(base: string, data: any): Promise<any>;
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
    getHistoryData(): any;
    setHistoryData(historyData: any): boolean;
    getHistoryConfigPath(): string;
    getHistoryPath(id: string): string;
}
