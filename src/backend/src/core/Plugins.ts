import * as fs from 'fs';
import * as path from 'path';
import { utils, globalState } from '../utils/globals';

export interface PluginItem {
    func: (...args: any[]) => any;
    extra?: any;
    getPrompt?: () => any;
    enabled?: boolean;
}

interface PluginInfo {
    version: string;
    path?: string;
    params?: any;
    extra?: any;
    enabled?: boolean;
}

export class Plugins {
    public static instance: Plugins | null = null;
    private tools: Record<string, PluginItem>;

    constructor() {
        Plugins.instance = this;
        this.tools = {};
    }

    public getTool(name?: string | null): any {
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
                enabled: enabled
            };
            return item;
        } catch (error: any) {
            console.error(`[Plugins] Failed to load plugin '${info.version}':`, error.message);
            return {
                func: () => `Plugin: ${info.version}, Path: ${pluginPath || 'built-in'}, Error: ${error.message}`
            };
        }
    }

    public init(config_name: string | null = null, forceLoad: boolean = false): void {
        const plugins = utils.getConfig("plugins", config_name);
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

        // 更新全局状态中的插件版本列表供前端使用
        globalState.pluginVersions = Object.keys(this.tools).map(version => ({ version, show: true }));
    }
}