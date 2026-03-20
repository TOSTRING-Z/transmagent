"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Plugins = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const globals_1 = require("../utils/globals");
const logger_1 = require("../utils/logger");
class Plugins {
    static instance = null;
    tools;
    constructor() {
        Plugins.instance = this;
        this.tools = {};
    }
    getTool(name) {
        if (name) {
            return this.tools[name] || null;
        }
        return this.tools;
    }
    loadPlugin(info) {
        const pluginPath = info.path;
        const pluginParams = info.params;
        const enabled = info?.enabled === false ? false : true;
        try {
            let plugin;
            if (pluginPath && fs.existsSync(pluginPath)) {
                try {
                    delete require.cache[require.resolve(pluginPath)];
                }
                catch (e) { }
                plugin = require(pluginPath);
            }
            else {
                // 从内置工具目录加载
                // 编译后路径: dist/core/Plugins.js -> dist/tools/{version}
                const builtinPath = path.join(__dirname, '..', 'tools', info.version);
                try {
                    delete require.cache[require.resolve(builtinPath)];
                }
                catch (e) { }
                plugin = require(builtinPath);
            }
            const item = {
                func: plugin.main(pluginParams),
                extra: info.extra,
                getPrompt: plugin.getPrompt,
                enabled: enabled
            };
            logger_1.logger.log(`[Plugins] Success to load plugin '${info.version}'`);
            return item;
        }
        catch (error) {
            logger_1.logger.error(`[Plugins] Failed to load plugin '${info.version}':`, error.message);
            return {
                func: () => `Plugin: ${info.version}, Path: ${pluginPath || 'built-in'}, Error: ${error.message}`
            };
        }
    }
    loadInit(config_name = null, forceLoad = false) {
        const plugins = globals_1.utils.getConfig("plugins", config_name);
        if (!plugins) {
            console.warn("[Plugins] No plugins configuration found.");
            return;
        }
        Object.keys(plugins).forEach((version) => {
            const info = {
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
            }
            else if (enabled) {
                if (!(version in this.tools)) {
                    this.tools[version] = this.loadPlugin(info);
                }
            }
            else {
                if (version in this.tools) {
                    delete this.tools[version];
                }
            }
        });
        // 更新全局状态中的插件版本列表供前端使用
        globals_1.globalState.pluginVersions = Object.keys(this.tools).map(version => ({ version, show: true }));
    }
}
exports.Plugins = Plugins;
//# sourceMappingURL=Plugins.js.map