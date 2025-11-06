const fs = require('fs');
const { utils } = require("./globals");

class Plugins {
    constructor() {
        Plugins.instance = this;
        this.tools = {};
    }

    getTool(name = null) {
        if (name) {
            return this.tools[name];
        }
        return this.tools;
    }

    // 配置插件接口
    loadPlugin(info) {
        const pluginPath = info?.path;
        const pluginParams = info?.params;
        try {
            let plugin;
            if (!!pluginPath && fs.existsSync(pluginPath)) {
                plugin = require(pluginPath);
            } else {
                // eslint-disable-next-line no-undef
                plugin = require(`../tools/${info.version}`);
            }
            let item;
            if (pluginParams) {
                item = { func: plugin.main(pluginParams), extra: info?.extra, getPrompt: plugin?.getPrompt };
            } else {
                item = { func: plugin.main, extra: info?.extra, getPrompt: plugin?.getPrompt };
            }
            return item;
        } catch (error) {
            console.log(error.message);
            return {
                func: () => `插件: ${info.version}, 路径: ${pluginPath}, 加载插件发生错误: ${error.message}`
            }
        }
    }

    init(config_name = null, forceLoad = false) {
        // 加载插件
        const plugins = utils.getConfig("plugins", config_name);
        Object.keys(plugins).forEach((version) => {
            const info = { version, path: plugins[version]?.path, ...plugins[version] }
            let enabled = true;
            if (Object.prototype.hasOwnProperty.call(info, "enabled")) {
                enabled = info.enabled;
            }
            if (enabled || forceLoad) {
                this.tools[version] = this.loadPlugin(info);
            }
        });
    }
}

module.exports = {
    Plugins
}