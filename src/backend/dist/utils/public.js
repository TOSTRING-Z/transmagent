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
exports.getSessionId = exports.copy = exports.formatDate = exports.getLanguage = exports.mergeConfigEnhanced = exports.getFile = exports.getSystem = exports.getDefault = exports.delay = exports.parseJsonContent = exports.extractJson = exports.hashCode = void 0;
const fs = __importStar(require("fs"));
const logger_1 = require("./logger");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const json5_1 = __importDefault(require("json5"));
const hashCode = (str) => {
    let hash = 0;
    if (str.length === 0)
        return hash.toString();
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
};
exports.hashCode = hashCode;
const extractJson = (text) => {
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
};
exports.extractJson = extractJson;
const parseJsonContent = (content) => {
    let content_parse = null;
    try {
        content_parse = json5_1.default.parse(content);
        return content_parse;
    }
    catch (e) {
        try {
            let content_json = (0, exports.extractJson)(content);
            if (content_json) {
                content_parse = json5_1.default.parse(content_json);
            }
            return content_parse;
        }
        catch (e) {
            return content_parse;
        }
    }
};
exports.parseJsonContent = parseJsonContent;
const delay = (seconds) => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
};
exports.delay = delay;
const getDefault = (name = "") => {
    return path.join(os.homedir(), '.transmagent', name);
};
exports.getDefault = getDefault;
const getSystem = (name = "config_transagent.json") => {
    // 注意：基于 src/utils 向上两级回到根目录
    return path.join(__dirname, '..', '..', 'configs', name);
};
exports.getSystem = getSystem;
const getFile = (file_path) => {
    if (fs.existsSync(file_path)) {
        return fs.readFileSync(file_path, 'utf-8');
    }
    return null;
};
exports.getFile = getFile;
const mergeConfigEnhanced = (defaultConfig, userConfig) => {
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
};
exports.mergeConfigEnhanced = mergeConfigEnhanced;
const getLanguage = () => {
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
};
exports.getLanguage = getLanguage;
const formatDate = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
exports.formatDate = formatDate;
const copy = (data) => {
    if (data) {
        return JSON.parse(JSON.stringify(data));
    }
    else {
        return data;
    }
};
exports.copy = copy;
const getSessionId = () => {
    return `chat-${crypto.randomUUID()}`;
};
exports.getSessionId = getSessionId;
//# sourceMappingURL=public.js.map