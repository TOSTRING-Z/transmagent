import * as fs from 'fs';
import { logger } from '../utils/logger';
import * as os from 'os';
import * as path from 'path';
import { formatString } from '../utils/format';
import { sysConfig } from '../utils/globals';
import { AgentMode } from '../types';
import { parseJsonContent } from '../utils/public';

// 定义允许用户覆盖的白名单字段
const OVERRIDABLE_KEYS = ['plugins', 'mcp_server', 'tool_call'];

export class Utils {
    public agentMode: AgentMode;
    constructor(agentMode: AgentMode) {
        this.agentMode = agentMode;
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

    public getDefault(name: string = ""): string {
        return path.join(os.homedir(), '.transmagent', name);
    }

    public getSystem(name: string = "config_transagent.json"): string {
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
        const configPath = file_path || this.getDefault(sysConfig[this.agentMode]);
        fs.writeFileSync(configPath, content);
        return true;
    }

    public getConfig(key: string | null = null, config_name: string | null = null): any {

        const defaultConfigPath = this.getDefault(sysConfig["transagent"]);
        const configFilePath = this.getDefault(config_name || sysConfig[this.agentMode]);

        // 1. 加载两个配置源
        let defaultConfig = fs.existsSync(defaultConfigPath) ? parseJsonContent(fs.readFileSync(defaultConfigPath, 'utf-8')) : {};
        let userConfig = fs.existsSync(configFilePath) ? parseJsonContent(fs.readFileSync(configFilePath, 'utf-8')) : {};

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
        if (key === null) return finalConfig;

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

    public setConfig(config: any): boolean {
        const defaultConfigPath = this.getDefault(sysConfig["transagent"]);
        const userConfigPath = this.getDefault(sysConfig[this.agentMode]);

        // 1. 读取现有的默认系统配置（作为基准，避免覆盖时丢失其他未传入的系统字段）
        let sysConfigData = fs.existsSync(defaultConfigPath)
            ? parseJsonContent(fs.readFileSync(defaultConfigPath, 'utf-8'))
            : {};

        // 2. 准备用于保存的特定模式配置
        const userConfigToSave: any = {};

        // 3. 遍历传入的 config，进行拆分分发
        for (const key in config) {
            if (OVERRIDABLE_KEYS.includes(key)) {
                // 白名单内的字段，归入特定模式的配置文件
                userConfigToSave[key] = config[key];
            } else {
                // 白名单外的字段，直接覆盖/更新到全局的系统配置文件
                sysConfigData[key] = config[key];
            }
        }

        // 4. 分别写入两个文件
        // 写入特定模式配置（白名单字段）
        fs.writeFileSync(userConfigPath, JSON.stringify(userConfigToSave, null, 2));

        // 写入全局默认配置（非白名单字段，如 models）
        fs.writeFileSync(defaultConfigPath, JSON.stringify(sysConfigData, null, 2));

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

    public getHistoryData(): any {
        let historyConfigPath = this.getHistoryConfigPath();
        if (!fs.existsSync(historyConfigPath)) {
            if (!fs.existsSync(path.dirname(historyConfigPath))) {
                fs.mkdirSync(path.dirname(historyConfigPath), { recursive: true });
            }
            return { data: [] };
        } else {
            const data = fs.readFileSync(historyConfigPath, 'utf-8');
            return parseJsonContent(data) || { data: [] };
        }
    }

    public setHistoryData(historyData: any) {
        const historyConfigPath = this.getHistoryConfigPath();
        // 先复杂一份临时文件，写入完成后再覆盖原文件，避免写入过程中程序异常导致数据损坏
        const tempFilePath = historyConfigPath + '.tmp';
        fs.writeFileSync(tempFilePath, JSON.stringify(historyData, null, 2));
        fs.renameSync(tempFilePath, historyConfigPath);
        return true;
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