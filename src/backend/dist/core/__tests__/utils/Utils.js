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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Utils = void 0;
var fs = __importStar(require("fs"));
var logger_1 = require("./logger");
var os = __importStar(require("os"));
var path = __importStar(require("path"));
var json5_1 = __importDefault(require("json5"));
var format_1 = require("./format");
var globals_1 = require("./globals");
var Utils = /** @class */ (function () {
    function Utils(agentMode) {
        this.agentMode = agentMode;
    }
    Utils.prototype.hashCode = function (str) {
        var hash = 0;
        if (str.length === 0)
            return hash.toString();
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    };
    Utils.prototype.sendData = function (base, data) {
        return __awaiter(this, void 0, void 0, function () {
            var backend_url, data_base, post_url, response, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        backend_url = this.getConfig("backend_url") || 'http://www.licpathway.net/transmagent_web';
                        data_base = "/data" + base;
                        post_url = backend_url + data_base;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, fetch(new URL(post_url), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(data)
                            })];
                    case 2:
                        response = _a.sent();
                        if (!response.ok) {
                            logger_1.logger.log("sendData HTTP error! status: ".concat(response.status));
                        }
                        return [4 /*yield*/, response.json()];
                    case 3: return [2 /*return*/, _a.sent()];
                    case 4:
                        error_1 = _a.sent();
                        logger_1.logger.log('sendData Error sending data:', error_1.message);
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    Utils.prototype.extractJson = function (text) {
        try {
            var startIndex = text.search(/[{[]/);
            if (startIndex === -1)
                return null;
            var stack = [];
            var isInsideString = false;
            for (var i = startIndex; i < text.length; i++) {
                var currentChar = text[i];
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
                    var candidate = text.substring(startIndex, i + 1);
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
    Utils.prototype.parseJsonContent = function (content) {
        var content_parse = null;
        try {
            content_parse = json5_1.default.parse(content);
            return content_parse;
        }
        catch (e) {
            try {
                var content_json = this.extractJson(content);
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
    Utils.prototype.delay = function (seconds) {
        return new Promise(function (resolve) { return setTimeout(resolve, seconds * 1000); });
    };
    Utils.prototype.getDefault = function (name) {
        if (name === void 0) { name = ""; }
        return path.join(os.homedir(), '.transmagent', name);
    };
    Utils.prototype.getSystem = function (name) {
        if (name === void 0) { name = "config_transagent.json"; }
        // 注意：基于 src/utils 向上两级回到根目录
        return path.join(__dirname, '..', '..', 'configs', name);
    };
    Utils.prototype.getFile = function (file_path) {
        if (fs.existsSync(file_path)) {
            return fs.readFileSync(file_path, 'utf-8');
        }
        return null;
    };
    Utils.prototype.setFile = function (content, file_path) {
        if (file_path === void 0) { file_path = null; }
        var configPath = file_path || this.getDefault(globals_1.sysConfig[this.agentMode]);
        fs.writeFileSync(configPath, content);
        return true;
    };
    Utils.prototype.getConfig = function (key, config_name) {
        if (key === void 0) { key = null; }
        if (config_name === void 0) { config_name = null; }
        var sysConfigFilePath = this.getSystem();
        var configFilePath = this.getDefault(config_name || globals_1.sysConfig[this.agentMode]);
        // 加入容错机制，防止系统首次运行无文件报错
        var defaultConfig = fs.existsSync(sysConfigFilePath) ? this.parseJsonContent(fs.readFileSync(sysConfigFilePath, 'utf-8')) : {};
        var userConfig = fs.existsSync(configFilePath) ? this.parseJsonContent(fs.readFileSync(configFilePath, 'utf-8')) : {};
        var enhancedResult = this.mergeConfigEnhanced(defaultConfig, userConfig);
        var config = enhancedResult.mergedConfig;
        if (key === null)
            return config;
        if (key === "models" && config["models"]) {
            var models = config["models"];
            var _loop_1 = function (mKey) {
                if (Object.hasOwnProperty.call(models, mKey)) {
                    var versions = models[mKey].versions;
                    if (Array.isArray(versions)) {
                        versions.forEach(function (version, i) {
                            config["models"][mKey].versions[i] = typeof version === "string" ? { version: version } : version;
                        });
                    }
                }
            };
            for (var mKey in models) {
                _loop_1(mKey);
            }
        }
        return config[key];
    };
    Utils.prototype.setConfig = function (config) {
        var configPath = this.getDefault(globals_1.sysConfig[this.agentMode]);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    };
    Utils.prototype.getSshConfig = function () {
        var _a;
        return (_a = this.getConfig("tool_call")) === null || _a === void 0 ? void 0 : _a.ssh_config;
    };
    Utils.prototype.mergeConfigEnhanced = function (defaultConfig, userConfig) {
        var result = {
            mergedConfig: JSON.parse(JSON.stringify(defaultConfig || {})),
            mismatches: [],
            addedKeys: []
        };
        function deepMerge(target, source, currentPath) {
            if (currentPath === void 0) { currentPath = ''; }
            for (var key in source) {
                var path_1 = currentPath ? "".concat(currentPath, ".").concat(key) : key;
                if (target[key] === undefined) {
                    result.addedKeys.push({ path: path_1, value: source[key], type: 'added' });
                    target[key] = JSON.parse(JSON.stringify(source[key]));
                    continue;
                }
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                        deepMerge(target[key], source[key], path_1);
                    }
                    else {
                        result.mismatches.push({
                            path: path_1,
                            default: target[key], user: source[key], type: 'type_mismatch',
                            description: "\u671F\u671B\u7C7B\u578B: ".concat(typeof target[key], "\uFF0C\u7528\u6237\u914D\u7F6E\u7C7B\u578B: object")
                        });
                        target[key] = JSON.parse(JSON.stringify(source[key]));
                    }
                }
                else {
                    var defaultVal = target[key];
                    var userVal = source[key];
                    if (JSON.stringify(defaultVal) !== JSON.stringify(userVal)) {
                        result.mismatches.push({
                            path: path_1,
                            default: defaultVal, user: userVal,
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
    Utils.prototype.getLanguage = function () {
        try {
            var locale = 'en-US';
            if (process.env.LANG) {
                locale = process.env.LANG.split('.')[0].replace('_', '-');
            }
            if (typeof globalThis !== 'undefined' && globalThis.navigator) {
                locale = globalThis.navigator.language;
            }
            locale = locale.replace('_', '-');
            var languageMap = {
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
    Utils.prototype.formatDate = function () {
        var date = new Date();
        var year = date.getFullYear();
        var month = (date.getMonth() + 1).toString().padStart(2, '0');
        var day = date.getDate().toString().padStart(2, '0');
        var hours = date.getHours().toString().padStart(2, '0');
        var minutes = date.getMinutes().toString().padStart(2, '0');
        var seconds = date.getSeconds().toString().padStart(2, '0');
        return "".concat(year, "-").concat(month, "-").concat(day, " ").concat(hours, ":").concat(minutes, ":").concat(seconds);
    };
    Utils.prototype.copy = function (data) {
        if (data) {
            return JSON.parse(JSON.stringify(data));
        }
        else {
            return data;
        }
    };
    Utils.prototype.getHistoryData = function () {
        var historyConfigPath = this.getHistoryConfigPath();
        if (!fs.existsSync(historyConfigPath)) {
            if (!fs.existsSync(path.dirname(historyConfigPath))) {
                fs.mkdirSync(path.dirname(historyConfigPath), { recursive: true });
            }
            return { data: [] };
        }
        else {
            var data = fs.readFileSync(historyConfigPath, 'utf-8');
            return this.parseJsonContent(data) || { data: [] };
        }
    };
    Utils.prototype.setHistoryData = function (historyData) {
        var historyConfigPath = this.getHistoryConfigPath();
        fs.writeFileSync(historyConfigPath, JSON.stringify(historyData, null, 2));
    };
    Utils.prototype.getHistoryConfigPath = function () {
        var historyPathTpl = this.getConfig("history_path");
        // 修复原代码中的 ?.format(process) 隐患
        var history_path = historyPathTpl ? (0, format_1.formatString)(historyPathTpl, process) : this.getDefault();
        return path.join(history_path, 'history.json');
    };
    Utils.prototype.getHistoryPath = function (id) {
        var historyPathTpl = this.getConfig("history_path");
        var history_path = historyPathTpl ? (0, format_1.formatString)(historyPathTpl, process) : this.getDefault();
        return path.join(history_path, 'history', "".concat(id, ".json"));
    };
    Utils.prototype.getImportantMemoryPath = function () {
        return this.getDefault("memory.md");
    };
    Utils.prototype.getLongMemoryPath = function () {
        var historyPathTpl = this.getConfig("history_path");
        var history_path = historyPathTpl ? (0, format_1.formatString)(historyPathTpl, process) : this.getDefault();
        var long_memory_path = path.join(history_path, 'long_memory');
        if (!fs.existsSync(long_memory_path)) {
            fs.mkdirSync(long_memory_path, { recursive: true });
        }
        return long_memory_path;
    };
    return Utils;
}());
exports.Utils = Utils;
