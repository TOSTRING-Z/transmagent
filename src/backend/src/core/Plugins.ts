import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
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

interface PluginInfo {
    version: string;
    path?: string;
    params?: any;
    extra?: any;
    enabled?: boolean;
    show?: boolean;
    require_confirmation?: boolean;
    require_audit?: boolean;
    confirmation_message?: string;
}

export class Plugins {
    public static instance: Plugins | null = null;
    private tools: Record<string, PluginItem>;
    private utils: Utils;

    constructor(utils: Utils) {
        this.utils = utils;
        this.tools = {};
        this.loadInit();
    }

    public getTool(name?: string | null): PluginItem | Record<string, PluginItem> {
        if (name) {
            return this.tools[name] || null;
        }
        return this.tools;
    }

    private loadPlugin(info: PluginInfo): PluginItem {
        const pluginPath = info.path;
        const pluginParams = info.params;
        const enabled = info?.enabled === false ? false : true

        try {
            let plugin: any;
            if (pluginPath && fs.existsSync(pluginPath)) {
                try {
                    delete require.cache[require.resolve(pluginPath)];
                } catch (e) { }
                plugin = require(pluginPath);
            } else {
                // 从内置工具目录加载
                // 编译后路径: dist/core/Plugins.js -> dist/tools/{version}
                const builtinPath = path.join(__dirname, '..', 'tools', info.version);
                try {
                    delete require.cache[require.resolve(builtinPath)];
                } catch (e) { }
                plugin = require(builtinPath);
            }

            const item: PluginItem = {
                func: plugin.main(pluginParams),
                extra: info.extra,
                getPrompt: plugin.getPrompt,
                enabled: enabled,
                show: info?.show,
                version: info?.version,
                params: info?.params,
                require_confirmation: info?.require_confirmation,
                require_audit: info?.require_audit,
                confirmation_message: info?.confirmation_message,
            };
            logger.log(`[Plugins] Success to load plugin '${info.version}'`);
            return item;
        } catch (error: any) {
            logger.error(`[Plugins] Failed to load plugin '${info.version}':`, error.message);
            return {
                func: () => `Plugin: ${info.version}, Path: ${pluginPath || 'built-in'}, Error: ${error.message}`
            };
        }
    }

    public loadInit(config_name: string | null = null, forceLoad: boolean = false): void {
        const plugins = this.utils.getConfig("plugins", config_name);
        if (!plugins) {
            console.warn("[Plugins] No plugins configuration found.");
            return;
        }

        Object.keys(plugins).forEach((version) => {
            const info: PluginInfo = {
                version,
                path: plugins[version]?.path,
                ...plugins[version]
            };

            let enabled = true;
            if (Object.prototype.hasOwnProperty.call(info, "enabled")) {
                enabled = !!info.enabled;
            }

            if (forceLoad) {
                this.tools[version] = this.loadPlugin(info);
            } else if (enabled) {
                if (!(version in this.tools)) {
                    this.tools[version] = this.loadPlugin(info);
                }
            } else {
                if (version in this.tools) {
                    delete this.tools[version];
                }
            }
        });
    }
}