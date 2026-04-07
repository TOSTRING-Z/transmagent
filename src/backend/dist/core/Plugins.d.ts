import { Utils } from './Utils';
export interface PluginItem {
    func: (...args: any[]) => any;
    extra?: any;
    getPrompt?: () => any;
    enabled?: boolean;
    show?: boolean;
    version?: string;
    params?: any;
    require_confirmation?: boolean;
    require_audit?: boolean;
    confirmation_message?: string;
}
export declare class Plugins {
    static instance: Plugins | null;
    private tools;
    private utils;
    constructor(utils: Utils);
    getTool(name?: string | null): PluginItem | Record<string, PluginItem>;
    private loadPlugin;
    loadInit(config_name?: string | null, forceLoad?: boolean): void;
}
