import { logger } from './logger';
import * as os from 'os';
import * as path from 'path';
import JSON5 from 'json5';
import { ChatState } from '../types';
import { formatString } from './format';
import { sysConfig } from './globals';
import { existsSync, mkdir, readFileSync, renameSync, writeFileSync } from 'fs';

export const hashCode = (str: string): string => {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
}

export const extractJson = (text: string): string | null => {
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

export const parseJsonContent = (content: string): any => {
    let content_parse: any = null;
    try {
        content_parse = JSON5.parse(content);
        return content_parse;
    } catch (e: any) {
        try {
            let content_json = extractJson(content);
            if (content_json) {
                content_parse = JSON5.parse(content_json);
            }
            return content_parse;
        } catch (e: any) {
            return content_parse;
        }
    }
}

export const delay = (seconds: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export const getDefault = (name: string = ""): string => {
    return path.join(os.homedir(), '.transmagent', name);
}

export const getSystem = (name: string = "config_transagent.json"): string => {
    // 注意：基于 src/utils 向上两级回到根目录
    return path.join(__dirname, '..', '..', 'configs', name);
}

export const getFile = (file_path: string): string | null => {
    if (existsSync(file_path)) {
        return readFileSync(file_path, 'utf-8');
    }
    return null;
}

export const mergeConfigEnhanced = (defaultConfig: any, userConfig: any) => {
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

export const getLanguage = (): string => {
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

export const formatDate = (): string => {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export const copy = <T>(data: T): T => {
    if (data) {
        return JSON.parse(JSON.stringify(data));
    } else {
        return data;
    }
}

export const getSessionId = (): string => {
    return `chat-${crypto.randomUUID()}`;
}

export const getDefaultConfig = (key: string | null = null): any => {

    const defaultConfigPath = getDefault(sysConfig["transagent"]);

    let defaultConfig = existsSync(defaultConfigPath) ? parseJsonContent(readFileSync(defaultConfigPath, 'utf-8')) : {};

    if (key === "models" && defaultConfig["models"]) {
        const models = defaultConfig["models"];
        for (const mKey in models) {
            if (Object.hasOwnProperty.call(models, mKey)) {
                const versions = models[mKey].versions;
                if (Array.isArray(versions)) {
                    versions.forEach((version, i) => {
                        defaultConfig["models"][mKey].versions[i] = typeof version === "string" ? { version: version } : version;
                    });
                }
            }
        }
    }

    if (key === null) return defaultConfig;

    return defaultConfig[key];
}

export const getDefaultHistoryConfigPath = (): string => {
    const historyPathTpl = getDefaultConfig("history_path");
    const history_path = historyPathTpl ? formatString(historyPathTpl, process as any) : getDefault();
    return path.join(history_path, 'history.json');
}

export const getDefaultHistoryPath = (id: string): string | null => {
    const historyPathTpl = getDefaultConfig("history_path");
    const history_path = historyPathTpl ? formatString(historyPathTpl, process as any) : getDefault();
    const file = path.join(history_path, 'history', `${id}.json`);
    return existsSync(file) ? file : null;
}

export const readJsonFile = (filePath: string) => {
    return existsSync(filePath) ? parseJsonContent(readFileSync(filePath, 'utf-8')) : {};
}

export const writeFile = async (filePath: string, data: string | object) => {
    // Creates the directory structure if it doesn't exist
    mkdir(path.dirname(filePath), { recursive: true }, (err) => {
        console.log(err?.message);
    });
    const tempFilePath = filePath + '.tmp';
    const content = typeof (data) === "string" ? data : JSON.stringify(data, null, 2)
    writeFileSync(tempFilePath, content);
    renameSync(tempFilePath, filePath);
}

export const getHistoryChat = (id): ChatState | undefined => {
    const historyPath = getDefaultHistoryPath(id);
    if (historyPath) {
        const data = readJsonFile(historyPath);
        if (data?.chat) return data.chat;
    }
}

export const setHistory = (chat): boolean => {
    const configStatu = setHistoryConfig(chat);
    const chatStatu = setHistoryChat(chat);
    return configStatu && chatStatu;
}

export const setHistoryChat = (chat): boolean => {
    try {
        const historyPath = getDefaultHistoryPath(chat.id);
        if (historyPath) {
            const data = readJsonFile(historyPath);
            if (data?.chat) {
                data.chat = chat;
                writeFile(historyPath, chat);
                return true
            }
            console.log("历史文件没有chat属性", historyPath)
        }
        console.log("历史文件不存在", historyPath)
        return false;
    } catch (error) {
        console.log("历史文件保存报错：", error)
        return false;
    }
}



export const setHistoryConfig = (chat: ChatState): boolean => {
    try {
        const defaultHistoryConfigPath = getDefaultHistoryConfigPath();
        const defaultHistoryConfigData = readJsonFile(defaultHistoryConfigPath);
        let hintData = defaultHistoryConfigData.data.filter((h: any) => h.id === chat.id);
        let idExist = hintData.length > 0;

        if (!idExist) {
            defaultHistoryConfigData.data.push(chat);
        } else {
            defaultHistoryConfigData.data = defaultHistoryConfigData.data.map((hChat: any) => hChat.id === chat.id ? chat : hChat);
        }
        writeFile(defaultHistoryConfigPath, defaultHistoryConfigData);
        return idExist;
    } catch (error) {
        console.log("历史配置文件保存报错：", error)
        return false;
    }

}

