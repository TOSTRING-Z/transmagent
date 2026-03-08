import * as fs from 'fs';
import { logger } from './logger';
import * as os from 'os';
import * as path from 'path';
import JSON5 from 'json5';
import { formatString } from './format';

export class Utils {
    private static instance: Utils;
    public inner: any;
    public configName: string | undefined;

    constructor(inner: any, configName: string) {
        if (!Utils.instance) {
            this.inner = inner;
            this.configName = configName;
            Utils.instance = this;
        }
        return Utils.instance;
    }

    public hashCode(str: string): string {
        let hash = 0;
        if (str.length === 0) return hash.toString();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }

    public async sendData(base: string, data: any): Promise<any> {
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
                logger.log(`sendData HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error: any) {
            logger.log('sendData Error sending data:', error.message);
        }
    }

    public extractJson(text: string): string | null {
        try {
            let startIndex = text.search(/[{[]/);
            if (startIndex === -1) return null;

            const stack: string[] = [];
            let isInsideString = false;

            for (let i = startIndex; i < text.length; i++) {
                const currentChar = text[i];

                if (currentChar === '"' && text[i - 1] !== '\\') {
                    isInsideString = !isInsideString;
                }

                if (isInsideString) continue;

                if (currentChar === '{' || currentChar === '[') {
                    stack.push(currentChar);
                } else if (
                    (currentChar === '}' && stack[stack.length - 1] === '{') ||
                    (currentChar === ']' && stack[stack.length - 1] === '[')
                ) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    const candidate = text.substring(startIndex, i + 1);
                    try {
                        return JSON.stringify(JSON5.parse(candidate), null, 2);
                    } catch (e: any) {
                        startIndex = text.indexOf('{', i + 1);
                        if (startIndex === -1) return null;
                        i = startIndex - 1;
                        stack.length = 0;
                    }
                }
            }
            return null;
        } catch (e: any) {
            return null;
        }
    }

    public parseJsonContent(content: string): any {
        let content_parse: any = null;
        try {
            content_parse = JSON5.parse(content);
            return content_parse;
        } catch (e: any) {
            try {
                let content_json = this.extractJson(content);
                if (content_json) {
                    content_parse = JSON5.parse(content_json);
                }
                return content_parse;
            } catch (e: any) {
                return content_parse;
            }
        }
    }

    public delay(seconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    public getDefault(name: string = ""): string {
        return path.join(os.homedir(), '.transmagent', name);
    }

    public getSystem(name: string = "config.json"): string {
        // 注意：基于 src/utils 向上两级回到根目录
        return path.join(__dirname, '..', '..', 'configs', name);
    }

    public getFile(file_path: string): string | null {
        if (fs.existsSync(file_path)) {
            return fs.readFileSync(file_path, 'utf-8');
        }
        return null;
    }

    public setFile(content: string, file_path: string | null = null): boolean {
        const configPath = file_path || this.getDefault(this.configName);
        fs.writeFileSync(configPath, content);
        return true;
    }

    public getConfig(key: string | null = null, config_name: string | null = null): any {
        const sysConfigFilePath = this.getSystem();
        const configFilePath = this.getDefault(config_name || this.configName);
        
        // 加入容错机制，防止系统首次运行无文件报错
        let defaultConfig = fs.existsSync(sysConfigFilePath) ? this.parseJsonContent(fs.readFileSync(sysConfigFilePath, 'utf-8')) : {};
        let userConfig = fs.existsSync(configFilePath) ? this.parseJsonContent(fs.readFileSync(configFilePath, 'utf-8')) : {};
        
        const enhancedResult = this.mergeConfigEnhanced(defaultConfig, userConfig);
        const config = enhancedResult.mergedConfig;

        if (key === null) return config;

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

    public setConfig(config: any): boolean {
        const configPath = this.getDefault(this.configName);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    }

    public getSshConfig(): any {
        return this.getConfig("tool_call")?.ssh_config;
    }

    public mergeConfigEnhanced(defaultConfig: any, userConfig: any) {
        const result = {
            mergedConfig: JSON.parse(JSON.stringify(defaultConfig || {})),
            mismatches: [] as any[],
            addedKeys: [] as any[]
        };

        function deepMerge(target: any, source: any, currentPath = '') {
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
                    } else {
                        result.mismatches.push({
                            path, default: target[key], user: source[key], type: 'type_mismatch',
                            description: `期望类型: ${typeof target[key]}，用户配置类型: object`
                        });
                        target[key] = JSON.parse(JSON.stringify(source[key]));
                    }
                } else {
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

    public getLanguage(): string {
        try {
            let locale = 'en-US';
            if (process.env.LANG) {
                locale = process.env.LANG.split('.')[0].replace('_', '-');
            }
            if (typeof globalThis !== 'undefined' && (globalThis as any).navigator) {
                locale = (globalThis as any).navigator.language;
            }
            locale = locale.replace('_', '-');

            const languageMap: Record<string, string> = {
                'zh': 'chinese', 'zh-CN': 'chinese', 'zh-TW': 'chinese', 'zh-HK': 'chinese',
                'en': 'english', 'en-US': 'english', 'en-GB': 'english'
            };
            return languageMap[locale] || languageMap[locale.split('-')[0]] || locale;
        } catch (error: any) {
            logger.log(error);
            return 'chinese';
        }
    }

    public formatDate(): string {
        const date = new Date();
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    public copy<T>(data: T): T {
        return JSON.parse(JSON.stringify(data));
    }

    public getHistoryData(): any {
        let historyConfigPath = this.getHistoryConfigPath();
        if (!fs.existsSync(historyConfigPath)) {
            if (!fs.existsSync(path.dirname(historyConfigPath))) {
                fs.mkdirSync(path.dirname(historyConfigPath), { recursive: true });
            }
            return { data: [] };
        } else {
            const data = fs.readFileSync(historyConfigPath, 'utf-8');
            return this.parseJsonContent(data) || { data: [] };
        }
    }

    public setHistoryData(historyData: any) {
        const historyConfigPath = this.getHistoryConfigPath();
        fs.writeFileSync(historyConfigPath, JSON.stringify(historyData, null, 2));
    }

    public getHistoryConfigPath(): string {
        const historyPathTpl = this.getConfig("history_path");
        // 修复原代码中的 ?.format(process) 隐患
        const history_path = historyPathTpl ? formatString(historyPathTpl, process as any) : this.getDefault();
        return path.join(history_path, 'history.json');
    }

    public getHistoryPath(id: string): string {
        const historyPathTpl = this.getConfig("history_path");
        const history_path = historyPathTpl ? formatString(historyPathTpl, process as any) : this.getDefault();
        return path.join(history_path, 'history', `${id}.json`);
    }

    public getImportantMemoryPath(): string {
        return this.getDefault("memory.md");
    }

    public getLongMemoryPath(): string {
        const historyPathTpl = this.getConfig("history_path");
        const history_path = historyPathTpl ? formatString(historyPathTpl, process as any) : this.getDefault();
        const long_memory_path = path.join(history_path, 'long_memory');
        if (!fs.existsSync(long_memory_path)) {
            fs.mkdirSync(long_memory_path, { recursive: true });
        }
        return long_memory_path;
    }
}