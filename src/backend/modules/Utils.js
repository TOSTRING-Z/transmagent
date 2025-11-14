const fs = require('fs');
const os = require('os');
const path = require('path');
const JSON5 = require("json5");
class Utils {
    constructor(inner, config) {
        if (!Utils.instance) {
            this.inner = inner;
            this.config = config;
            Utils.instance = this;
        }
        return Utils.instance;
    }

    // 生成一个唯一的哈希值（固定长度）
    hashCode(str) {
        let hash = 0;
        if (str.length === 0) return hash.toString();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char; // 位移和加法
            hash |= 0; // 强制转换为32位整数
        }
        return Math.abs(hash).toString(16); // 返回正数的十六进制表示
    }

    async sendData(base, data) {
        const backend_url = this.getConfig("backend_url") || 'http://www.licpathway.net/transmagent_web';
        const data_base = "/data" + base;
        const post_url = backend_url + data_base;

        try {
            const response = await fetch(new URL(post_url), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                console.log(`sendData HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.log('sendData Error sending data:', error.message);
        }
    }

    extractJson(text) {
        try {
            let startIndex = text.search(/[{[]/);
            if (startIndex === -1) return null;

            const stack = [];
            let isInsideString = false;

            for (let i = startIndex; i < text.length; i++) {
                const currentChar = text[i]; // 合并 currentChar 声明

                // 处理字符串内的转义字符（如 \"）
                if (currentChar === '"' && text[i - 1] !== '\\') {
                    isInsideString = !isInsideString;
                }

                if (isInsideString) continue;

                // 跟踪括号层级
                if (currentChar === '{' || currentChar === '[') {
                    stack.push(currentChar);
                } else if (
                    (currentChar === '}' && stack[stack.length - 1] === '{') ||
                    (currentChar === ']' && stack[stack.length - 1] === '[')
                ) {
                    stack.pop();
                }

                // 当所有括号闭合时尝试解析
                if (stack.length === 0) {
                    const candidate = text.substring(startIndex, i + 1);
                    try {
                        return JSON.stringify(JSON5.parse(candidate), null, 2);
                    } catch {
                        // 继续扫描后续内容
                        startIndex = text.indexOf('{', i + 1);
                        if (startIndex === -1) return null;
                        i = startIndex - 1;
                        stack.length = 0;
                    }
                }
            }
            return null;
        } catch {
            return null;
        }

    }

    parseJsonContent(content) {
        let content_parse = null;
        try {
            content_parse = JSON5.parse(content);
            return content_parse;
        } catch {
            try {
                let content_json = this.extractJson(content);
                if (content_json) {
                    content_parse = JSON5.parse(content_json);
                }
                return content_parse;
            } catch {
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

    getSystem(name = "config.json") {
        // eslint-disable-next-line no-undef
        return path.join(__dirname, '..', name);
    }

    getConfig(key = null, config_name = null) {
        const sysConfigFilePath = this.getSystem();
        const configFilePath = this.getDefault(config_name || this.config);
        let defaultConfig = this.parseJsonContent(fs.readFileSync(sysConfigFilePath, 'utf-8'));
        let userConfig = this.parseJsonContent(fs.readFileSync(configFilePath, 'utf-8'));
        const enhancedResult = this.mergeConfigEnhanced(defaultConfig, userConfig);
        const config = enhancedResult.mergedConfig;
        // console.log(`修改：${JSON.stringify(enhancedResult.mismatches, null, 2)}`);
        // console.log(`新增：${JSON.stringify(enhancedResult.addedKeys, null, 2)}`);
        if (key === null) {
            return config;
        }
        if (key == "models") {
            const models = config["models"];
            for (const key in models) {
                if (Object.hasOwnProperty.call(models, key)) {
                    const versions = models[key].versions;
                    versions.forEach((version, i) => {
                        version = typeof version == "string" ? { version: version } : version;
                        config["models"][key].versions[i] = version;
                    });
                }
            }
        }
        return config[key];
    }

    setConfig(config) {
        const configPath = this.getDefault(this.config);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); // 美化输出
        return true;
    }

    getSshConfig() {
        const sshConfig = this.getConfig("tool_call")?.ssh_config;
        return sshConfig;
    }

    /**
     * 增强版配置合并函数
     * @param {Object} defaultConfig 系统默认配置
     * @param {Object} userConfig 用户配置
     * @returns {Object} 包含完整配置、不匹配项和新增项的对象
     */
    mergeConfigEnhanced(defaultConfig, userConfig) {
        const result = {
            mergedConfig: JSON.parse(JSON.stringify(defaultConfig)),
            mismatches: [],
            addedKeys: []
        };

        /**
         * 递归合并对象
         */
        function deepMerge(target, source, path = '') {
            for (const key in source) {
                const currentPath = path ? `${path}.${key}` : key;

                // 检查是否是新增的键
                if (target[key] === undefined) {
                    result.addedKeys.push({
                        path: currentPath,
                        value: source[key],
                        type: 'added'
                    });
                    target[key] = JSON.parse(JSON.stringify(source[key]));
                    continue;
                }

                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    // 处理对象
                    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                        deepMerge(target[key], source[key], currentPath);
                    } else {
                        // 类型不匹配
                        result.mismatches.push({
                            path: currentPath,
                            default: target[key],
                            user: source[key],
                            type: 'type_mismatch',
                            description: `期望类型: ${typeof target[key]}，用户配置类型: object`
                        });
                        target[key] = JSON.parse(JSON.stringify(source[key]));
                    }
                } else {
                    // 处理基本类型和数组
                    const defaultVal = target[key];
                    const userVal = source[key];

                    if (JSON.stringify(defaultVal) !== JSON.stringify(userVal)) {
                        result.mismatches.push({
                            path: currentPath,
                            default: defaultVal,
                            user: userVal,
                            type: Array.isArray(userVal) ? 'array_override' : 'value_override',
                            description: Array.isArray(userVal) ? '数组被覆盖' : '值被覆盖'
                        });
                    }
                    target[key] = JSON.parse(JSON.stringify(userVal));
                }
            }
        }

        deepMerge(result.mergedConfig, userConfig);
        return result;
    }

    getLanguage() {
        try {
            let locale = 'en-US';

            // eslint-disable-next-line no-undef
            if (process.env.LANG) {
                // eslint-disable-next-line no-undef
                locale = process.env.LANG.split('.')[0].replace('_', '-');
            }

            if (typeof navigator !== 'undefined') {
                locale = navigator.language;
            }

            locale = locale.replace('_', '-');

            const languageMap = {
                'zh': 'chinese',
                'zh-CN': 'chinese',
                'zh-TW': 'chinese',
                'zh-HK': 'chinese',
                'en': 'english',
                'en-US': 'english',
                'en-GB': 'english'
            };

            return languageMap[locale] ||
                languageMap[locale.split('-')[0]] ||
                locale;
        } catch (error) {
            console.log(error);
            return 'chinese';
        }

    }

    formatDate() {
        const date = new Date();
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); // 月份是从0开始的
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    copy(data) {
        return JSON.parse(JSON.stringify(data));
    }

    getHistoryData() {
        let historyConfigPath = this.getHistoryConfigPath();
        if (!fs.existsSync(historyConfigPath)) {
            if (!fs.existsSync(path.dirname(historyConfigPath))) {
                fs.mkdirSync(path.dirname(historyConfigPath), { recursive: true });
            }
            return { data: [] }
        } else {
            const data = fs.readFileSync(historyConfigPath, 'utf-8');
            let historyData = this.parseJsonContent(data) || { data: [] };
            return historyData
        }
    }

    setHistoryData(historyData) {
        const historyConfigPath = this.getHistoryConfigPath();
        fs.writeFileSync(historyConfigPath, JSON.stringify(historyData, null, 2));
    }

    getHistoryConfigPath() {
        // eslint-disable-next-line no-undef
        const history_path = this.getConfig("history_path")?.format(process) || this.getDefault();
        const historyConfigPath = path.join(history_path, 'history.json');
        return historyConfigPath;
    }

    getHistoryPath(id) {
        // eslint-disable-next-line no-undef
        const history_path = this.getConfig("history_path")?.format(process) || this.getDefault();
        const history_file = path.join(history_path, 'history', `${id}.json`);
        return history_file;
    }
}

module.exports = {
    Utils
};