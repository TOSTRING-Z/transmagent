export interface PluginItem {
    func: (...args: any[]) => any;
    extra?: any;
    getPrompt?: () => any;
    enabled?: boolean;
}
export declare class Plugins {
    static instance: Plugins | null;
    private tools;
    constructor();
    getTool(name?: string | null): PluginItem | Record<string, PluginItem>;
    private loadPlugin;
    loadInit(config_name?: string | null, forceLoad?: boolean): void;
}
