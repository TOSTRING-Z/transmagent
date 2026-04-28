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
exports.Utils = void 0;
const fs = __importStar(require("fs"));
const logger_1 = require("../utils/logger");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const format_1 = require("../utils/format");
const globals_1 = require("../utils/globals");
const public_1 = require("../utils/public");
// 定义允许用户覆盖的白名单字段
const OVERRIDABLE_KEYS = ['plugins', 'mcp_server', 'tool_call'];
class Utils {
    constructor(agentMode) {
        this.agentMode = agentMode;
    }
    async sendData(base, data) {
        const backend_url = this.getConfig("backend_url") || 'http://www.licpathway.net/transmagent_web';
        const data_base = "/data" + base;
        const post_url = backend_url + data_base;
        try {
            const response = await fetch(new URL(post_url), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                logger_1.logger.log(`sendData HTTP error! status: ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            logger_1.logger.log('sendData Error sending data:', error.message);
        }
    }
    getDefault(name = "") {
        return path.join(os.homedir(), '.transmagent', name);
    }
    getSystem(name = "config_transagent.json") {
        // 注意：基于 src/utils 向上两级回到根目录
        return path.join(__dirname, '..', '..', 'configs', name);
    }
    getFile(file_path) {
        if (fs.existsSync(file_path)) {
            return fs.readFileSync(file_path, 'utf-8');
        }
        return null;
    }
    setFile(content, file_path = null) {
        const configPath = file_path || this.getDefault(globals_1.sysConfig[this.agentMode]);
        fs.writeFileSync(configPath, content);
        return true;
    }
    getConfig(key = null, config_name = null) {
        const defaultConfigPath = this.getDefault(globals_1.sysConfig["transagent"]);
        const configFilePath = this.getDefault(config_name || globals_1.sysConfig[this.agentMode]);
        // 1. 加载两个配置源
        let defaultConfig = fs.existsSync(defaultConfigPath) ? (0, public_1.parseJsonContent)(fs.readFileSync(defaultConfigPath, 'utf-8')) : {};
        let userConfig = fs.existsSync(configFilePath) ? (0, public_1.parseJsonContent)(fs.readFileSync(configFilePath, 'utf-8')) : {};
        // 2. 构造最终配置
        // 我们首先以 defaultConfig 为基准
        let finalConfig = { ...defaultConfig };
        // 3. 仅合并白名单内的字段
        OVERRIDABLE_KEYS.forEach(whiteKey => {
            if (userConfig[whiteKey] !== undefined) {
                // 如果用户配置中有该字段，则进行深度合并或覆盖
                const enhanced = this.mergeConfigEnhanced({ [whiteKey]: defaultConfig[whiteKey] }, { [whiteKey]: userConfig[whiteKey] });
                finalConfig[whiteKey] = enhanced.mergedConfig[whiteKey];
            }
        });
        // 4. 特殊处理：如果 key 为 null，返回过滤后的合并结果
        if (key === null)
            return finalConfig;
        // 5. 模型版本兼容性转换逻辑（保持原样）
        if (key === "models" && finalConfig["models"]) {
            const models = finalConfig["models"];
            for (const mKey in models) {
                if (Object.hasOwnProperty.call(models, mKey)) {
                    const versions = models[mKey].versions;
                    if (Array.isArray(versions)) {
                        versions.forEach((version, i) => {
                            finalConfig["models"][mKey].versions[i] = typeof version === "string" ? { version: version } : version;
                        });
                    }
                }
            }
        }
        // 6. 返回结果：如果是白名单外字段，这里自然会拿到 defaultConfig 的值
        return finalConfig[key];
    }
    setConfig(config) {
        const defaultConfigPath = this.getDefault(globals_1.sysConfig["transagent"]);
        const userConfigPath = this.getDefault(globals_1.sysConfig[this.agentMode]);
        const isSameFile = defaultConfigPath === userConfigPath;
        // 读取现有的默认系统配置
        let sysConfigData = fs.existsSync(defaultConfigPath)
            ? (0, public_1.parseJsonContent)(fs.readFileSync(defaultConfigPath, 'utf-8'))
            : {};
        // 如果是同一个文件，直接合并所有字段
        if (isSameFile) {
            for (const key in config) {
                sysConfigData[key] = config[key];
            }
            fs.writeFileSync(defaultConfigPath, JSON.stringify(sysConfigData, null, 2));
            return true;
        }
        // 不同文件时，按原有逻辑拆分
        const userConfigToSave = {};
        for (const key in config) {
            if (OVERRIDABLE_KEYS.includes(key)) {
                userConfigToSave[key] = config[key];
            }
            else {
                sysConfigData[key] = config[key];
            }
        }
        fs.writeFileSync(userConfigPath, JSON.stringify(userConfigToSave, null, 2));
        fs.writeFileSync(defaultConfigPath, JSON.stringify(sysConfigData, null, 2));
        return true;
    }
    getSshConfig() {
        return this.getConfig("tool_call")?.ssh_config;
    }
    mergeConfigEnhanced(defaultConfig, userConfig) {
        const result = {
            mergedConfig: JSON.parse(JSON.stringify(defaultConfig || {})),
            mismatches: [],
            addedKeys: []
        };
        function deepMerge(target, source, currentPath = '') {
            for (const key in source) {
                const path = currentPath ? `${currentPath}.${key}` : key;
                if (target[key] === undefined) {
                    result.addedKeys.push({ path, value: source[key], type: 'added' });
                    target[key] = JSON.parse(JSON.stringify(source[key]));
                    continue;
                }
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                        deepMerge(target[key], source[key], path);
                    }
                    else {
                        result.mismatches.push({
                            path, default: target[key], user: source[key], type: 'type_mismatch',
                            description: `期望类型: ${typeof target[key]}，用户配置类型: object`
                        });
                        target[key] = JSON.parse(JSON.stringify(source[key]));
                    }
                }
                else {
                    const defaultVal = target[key];
                    const userVal = source[key];
                    if (JSON.stringify(defaultVal) !== JSON.stringify(userVal)) {
                        result.mismatches.push({
                            path, default: defaultVal, user: userVal,
                            type: Array.isArray(userVal) ? 'array_override' : 'value_override'
                        });
                    }
                    target[key] = JSON.parse(JSON.stringify(userVal));
                }
            }
        }
        deepMerge(result.mergedConfig, userConfig || {});
        return result;
    }
    getLanguage() {
        try {
            let locale = 'en-US';
            if (process.env.LANG) {
                locale = process.env.LANG.split('.')[0].replace('_', '-');
            }
            if (typeof globalThis !== 'undefined' && globalThis.navigator) {
                locale = globalThis.navigator.language;
            }
            locale = locale.replace('_', '-');
            const languageMap = {
                'zh': 'chinese', 'zh-CN': 'chinese', 'zh-TW': 'chinese', 'zh-HK': 'chinese',
                'en': 'english', 'en-US': 'english', 'en-GB': 'english'
            };
            return languageMap[locale] || languageMap[locale.split('-')[0]] || locale;
        }
        catch (error) {
            logger_1.logger.log(error);
            return 'chinese';
        }
    }
    getHistoryData() {
        let historyConfigPath = this.getHistoryConfigPath();
        if (!fs.existsSync(historyConfigPath)) {
            if (!fs.existsSync(path.dirname(historyConfigPath))) {
                fs.mkdirSync(path.dirname(historyConfigPath), { recursive: true });
            }
            return { data: [] };
        }
        else {
            const data = fs.readFileSync(historyConfigPath, 'utf-8');
            return (0, public_1.parseJsonContent)(data) || { data: [] };
        }
    }
    setHistoryData(historyData) {
        const historyConfigPath = this.getHistoryConfigPath();
        // 先复杂一份临时文件，写入完成后再覆盖原文件，避免写入过程中程序异常导致数据损坏
        const tempFilePath = historyConfigPath + '.tmp';
        fs.writeFileSync(tempFilePath, JSON.stringify(historyData, null, 2));
        fs.renameSync(tempFilePath, historyConfigPath);
        return true;
    }
    getHistoryConfigPath() {
        const historyPathTpl = this.getConfig("history_path");
        // 修复原代码中的 ?.format(process) 隐患
        const history_path = historyPathTpl ? (0, format_1.formatString)(historyPathTpl, process) : this.getDefault();
        return path.join(history_path, 'history.json');
    }
    getHistoryPath(id) {
        const historyPathTpl = this.getConfig("history_path");
        const history_path = historyPathTpl ? (0, format_1.formatString)(historyPathTpl, process) : this.getDefault();
        return path.join(history_path, 'history', `${id}.json`);
    }
}
exports.Utils = Utils;
