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
exports.CHAT_CONST = exports.extraPrompt = exports.sysConfig = exports.CONSTANTS = exports.store = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function createStore() {
    const configPath = path.join(os.homedir(), '.transmagent', 'story.json');
    const ensureConfigFile = () => {
        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, '{}');
        }
    };
    ensureConfigFile();
    return {
        set: (name, value) => {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config[name] = value;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        },
        get: (name, defaultValue = undefined) => {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const value = config[name];
            if (value === undefined && defaultValue !== undefined) {
                return defaultValue;
            }
            return value;
        }
    };
}
exports.store = createStore();
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
exports.CHAT_CONST = {
    DEFAULT_NAME: "New Chat"
};
//# sourceMappingURL=globals.js.map