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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
const fs = __importStar(require("fs"));
const logger_1 = require("./logger");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const json5_1 = __importDefault(require("json5"));
const format_1 = require("./format");
const globals_1 = require("./globals");
class Utils {
    agentMode;
    constructor(agentMode) {
        this.agentMode = agentMode;
    }
    hashCode(str) {
        let hash = 0;
        if (str.length === 0)
            return hash.toString();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
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
    extractJson(text) {
        try {
            let startIndex = text.search(/[{[]/);
            if (startIndex === -1)
                return null;
            const stack = [];
            let isInsideString = false;
            for (let i = startIndex; i < text.length; i++) {
                const currentChar = text[i];
                if (currentChar === '"' && text[i - 1] !== '\\') {
                    isInsideString = !isInsideString;
                }
                if (isInsideString)
                    continue;
                if (currentChar === '{' || currentChar === '[') {
                    stack.push(currentChar);
                }
                else if ((currentChar === '}' && stack[stack.length - 1] === '{') ||
                    (currentChar === ']' && stack[stack.length - 1] === '[')) {
                    stack.pop();
                }
                if (stack.length === 0) {
                    const candidate = text.substring(startIndex, i + 1);
                    try {
                        return JSON.stringify(json5_1.default.parse(candidate), null, 2);
                    }
                    catch (e) {
                        startIndex = text.indexOf('{', i + 1);
                        if (startIndex === -1)
                            return null;
                        i = startIndex - 1;
                        stack.length = 0;
                    }
                }
            }
            return null;
        }
        catch (e) {
            return null;
        }
    }
    parseJsonContent(content) {
        let content_parse = null;
        try {
            content_parse = json5_1.default.parse(content);
            return content_parse;
        }
        catch (e) {
            try {
                let content_json = this.extractJson(content);
                if (content_json) {
                    content_parse = json5_1.default.parse(content_json);
                }
                return content_parse;
            }
            catch (e) {
                return content_parse;
            }
        }
    }
    delay(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
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
        const sysConfigFilePath = this.getSystem();
        const configFilePath = this.getDefault(config_name || globals_1.sysConfig[this.agentMode]);
        // 加入容错机制，防止系统首次运行无文件报错
        let defaultConfig = fs.existsSync(sysConfigFilePath) ? this.parseJsonContent(fs.readFileSync(sysConfigFilePath, 'utf-8')) : {};
        let userConfig = fs.existsSync(configFilePath) ? this.parseJsonContent(fs.readFileSync(configFilePath, 'utf-8')) : {};
        const enhancedResult = this.mergeConfigEnhanced(defaultConfig, userConfig);
        const config = enhancedResult.mergedConfig;
        if (key === null)
            return config;
        if (key === "models" && config["models"]) {
            const models = config["models"];
            for (const mKey in models) {
                if (Object.hasOwnProperty.call(models, mKey)) {
                    const versions = models[mKey].versions;
                    if (Array.isArray(versions)) {
                        versions.forEach((version, i) => {
                            config["models"][mKey].versions[i] = typeof version === "string" ? { version: version } : version;
                        });
                    }
                }
            }
        }
        return config[key];
    }
    setConfig(config) {
        const configPath = this.getDefault(globals_1.sysConfig[this.agentMode]);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
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
    formatDate() {
        const date = new Date();
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    copy(data) {
        if (data) {
            return JSON.parse(JSON.stringify(data));
        }
        else {
            return data;
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
            return this.parseJsonContent(data) || { data: [] };
        }
    }
    setHistoryData(historyData) {
        const historyConfigPath = this.getHistoryConfigPath();
        fs.writeFileSync(historyConfigPath, JSON.stringify(historyData, null, 2));
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
    getImportantMemoryPath() {
        return this.getDefault("memory.md");
    }
    getLongMemoryPath() {
        const historyPathTpl = this.getConfig("history_path");
        const history_path = historyPathTpl ? (0, format_1.formatString)(historyPathTpl, process) : this.getDefault();
        const long_memory_path = path.join(history_path, 'long_memory');
        if (!fs.existsSync(long_memory_path)) {
            fs.mkdirSync(long_memory_path, { recursive: true });
        }
        return long_memory_path;
    }
}
exports.Utils = Utils;
//# sourceMappingURL=Utils.js.map