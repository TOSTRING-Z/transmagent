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
exports.CHAT_CONST = exports.getCliPromptPath = exports.extraPrompt = exports.sysConfig = exports.CONSTANTS = exports.utils = exports.store = void 0;
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var os = __importStar(require("os"));
var Utils_1 = require("./Utils");
function createStore() {
    var configPath = path.join(os.homedir(), '.transmagent', 'story.json');
    var ensureConfigFile = function () {
        var dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, '{}');
        }
    };
    ensureConfigFile();
    return {
        set: function (name, value) {
            var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config[name] = value;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        },
        get: function (name, defaultValue) {
            if (defaultValue === void 0) { defaultValue = undefined; }
            var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            var value = config[name];
            if (value === undefined && defaultValue !== undefined) {
                return defaultValue;
            }
            return value;
        }
    };
}
exports.store = createStore();
exports.utils = new Utils_1.Utils(exports.store.get('agentMode', 'transagent'));
exports.CONSTANTS = {
    COLLECTION_URL: '/collection',
    PLUGIN_MODEL_NAME: 'plugins'
};
exports.sysConfig = {
    transagent: "configs/config_transagent.json",
    baseagent: "configs/config_baseagent.json",
    multagent: "configs/config_multagent.json",
};
exports.extraPrompt = {
    transagent: "prompts/transagent.md",
    baseagent: "prompts/baseagent.md",
    multagent: "prompts/multagent.md",
};
var getCliPromptPath = function () { return exports.utils.getConfig("tool_call").cli_prompt || exports.utils.getDefault("prompts/cli_prompt.md"); };
exports.getCliPromptPath = getCliPromptPath;
exports.CHAT_CONST = {
    DEFAULT_NAME: "New Chat"
};
