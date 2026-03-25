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
export const utils = new Utils();

export const CONSTANTS = {
    COLLECTION_URL: '/collection',
    PLUGIN_MODEL_NAME: 'plugins'
};


export const sysConfig = {
    transagent: "configs/config.json",
    baseagent: "configs/config_baseagent.json",
    multagent: "configs/config_multagent.json",
};

export const extraPrompt = {
    transagent: "prompts/transagent.md",
    baseagent: "prompts/baseagent.md",
    multagent: "prompts/multagent.md",
};

export const getCliPromptPath = () => utils.getConfig("tool_call").cli_prompt || utils.getDefault("prompts/cli_prompt.md")

export const CHAT_CONST = {
    DEFAULT_NAME: "New Chat"
};
