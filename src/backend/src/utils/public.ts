import { logger } from './logger';
import * as os from 'os';
import * as path from 'path';
import JSON5 from 'json5';
import { ChatState, Message } from '../types';
import { formatString } from './format';
import { sysConfig } from './globals';
import { existsSync, mkdir, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';

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

    const defaultConfigPath = '/home/tostring/.transmagent/configs/config_transagent.json';

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

export const getDefaultHistoryPath = (id: string): string => {
    const historyPathTpl = getDefaultConfig("history_path");
    const history_path = historyPathTpl ? formatString(historyPathTpl, process as any) : getDefault();
    const file = path.join(history_path, 'history', `${id}.json`);
    return file;
}

export const readJsonFile = (filePath: string) => {
    return existsSync(filePath) ? parseJsonContent(readFileSync(filePath, 'utf-8')) : {};
}

export const writeFile = async (filePath: string, data: string | object) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempFilePath = filePath + '.tmp';
    const content = typeof (data) === "string" ? data : JSON.stringify(data, null, 2)
    writeFileSync(tempFilePath, content);
    renameSync(tempFilePath, filePath);
}

export const deleteFile = (filePath: string): boolean => {
    if (existsSync(filePath)) {
        unlinkSync(filePath);
        return true;
    } else {
        return false;
    }
}

export const delHistoryChat = (id: string) => {
    const defaultHistoryConfigPath = getDefaultHistoryConfigPath();
    const defaultHistoryConfig = readJsonFile(defaultHistoryConfigPath);
    defaultHistoryConfig.data = defaultHistoryConfig.data.filter((h: any) => h.id !== id);
    const historyPath = getDefaultHistoryPath(id);
    writeFile(defaultHistoryConfigPath, defaultHistoryConfig)
    deleteFile(historyPath);
}

export const getHistoryChat = (id): ChatState | undefined => {
    const historyPath = getDefaultHistoryPath(id);
    const data = readJsonFile(historyPath);
    if (data?.chat) return data.chat;
}

export const getHistoryMessages = (id): Message[] | undefined => {
    const historyPath = getDefaultHistoryPath(id);
    const data = readJsonFile(historyPath);
    if (data?.messages) return data.messages;
}

export const setHistory = (chat, messages: Message[] | undefined = undefined): boolean => {
    if (chat?.id) {
        const configStatu = setHistoryConfigChat(chat);
        const chatStatu = setHistoryChat(chat);
        let messagesStatu = true;
        if (messages) {
            messagesStatu = setHistoryMessages(chat.id, messages)
        }
        return configStatu && chatStatu && messagesStatu;
    }
    return false;
}

export const setHistoryMessages = (chatId, messages): boolean => {
    try {
        const historyPath = getDefaultHistoryPath(chatId);
        const data = readJsonFile(historyPath);
        data.messages = messages;
        writeFile(historyPath, data);
        return true;
    } catch (error) {
        console.log("历史文件保存报错：", error);
        return false;
    }
}

export const setHistoryChat = (chat): boolean => {
    try {
        const historyPath = getDefaultHistoryPath(chat.id);
        if (!existsSync(path.dirname(historyPath))) {
            mkdirSync(path.dirname(historyPath), { recursive: true });
        }
        const data = readJsonFile(historyPath);
        data.chat = chat;
        writeFile(historyPath, data);
        return true
    } catch (error) {
        console.log("历史文件保存报错：", error)
        return false;
    }
}

export const setHistoryConfigChat = (chat: ChatState): boolean => {
    try {
        const defaultHistoryConfigPath = getDefaultHistoryConfigPath();
        let defaultHistoryConfig = readJsonFile(defaultHistoryConfigPath)
        if (!defaultHistoryConfig?.data) {
            defaultHistoryConfig.data = [];
        }
        let hintData = defaultHistoryConfig.data.filter((h: any) => h.id === chat.id);
        let idExist = hintData.length > 0;

        // 添加保存时间戳
        (chat as any).savedAt = new Date().toISOString();

        if (!idExist) {
            defaultHistoryConfig.data.push(chat);
        } else {
            defaultHistoryConfig.data = defaultHistoryConfig.data.filter((hChat: any) => hChat.id !== chat.id);
            defaultHistoryConfig.data.push(chat);
        }
        writeFile(defaultHistoryConfigPath, defaultHistoryConfig);
        console.log("历史配置文件保存成功：", chat.id);
        return idExist;
    } catch (error) {
        console.log("历史配置文件保存报错：", error)
        return false;
    }
}

export const setDefaultConfig = (config: Record<string, any>, configName: string = sysConfig["transagent"]): boolean => {
    try {
        const configPath = getDefault(configName);
        const existingConfig = readJsonFile(configPath);
        const mergedConfig = { ...existingConfig, ...config };
        writeFile(configPath, mergedConfig);
        return true;
    } catch (error) {
        console.log("默认配置文件保存报错：", error);
        return false;
    }
}

/**
 * 检查静默模式是否启用
 * @returns boolean - 静默模式状态，默认返回 false
 */
export const isSilentMode = (): boolean => {
    try {
        const funcStatus = getDefaultConfig("func_status");
        return !!(funcStatus?.silent);
    } catch (error) {
        logger.log("检查静默模式失败:", error);
        return false;
    }
}

