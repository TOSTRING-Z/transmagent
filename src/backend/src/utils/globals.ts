import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Utils } from './Utils';

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
        set: (name: string, value: any) => {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config[name] = value;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        },
        get: (name: string, defaultValue: any = undefined) => {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const value = config[name];
            if (value === undefined && defaultValue !== undefined) {
                return defaultValue;
            }
            return value;
        }
    };
}

export const store = createStore();

export const CONSTANTS = {
    COLLECTION_URL: '/collection',
    PLUGIN_MODEL_NAME: 'plugins'
};


export const sysConfig = {
    transagent: "config.json",
    baseagent: "config_baseagent.json",
    multagent: "config_multagent.json",
};

export const utils = new Utils(store.get('config', sysConfig.transagent));

export const globalState = {
    pluginVersions: [] as any[],

    config: store.get('config', sysConfig.transagent),
    last_clipboard_content: null as string | null,
    concat: false,
    status: {
        auto_opt: false
    }
};

export const CHAT_CONST = {
    DEFAULT_NAME: "New Chat"
};