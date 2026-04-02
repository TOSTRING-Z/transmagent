import { Utils } from './Utils';
export declare const store: {
    set: (name: string, value: any) => void;
    get: (name: string, defaultValue?: any) => any;
};
export declare let utils: Utils;
export declare const CONSTANTS: {
    COLLECTION_URL: string;
    PLUGIN_MODEL_NAME: string;
};
export declare const sysConfig: {
    transagent: string;
    baseagent: string;
    multagent: string;
};
export declare const extraPrompt: {
    transagent: string;
    baseagent: string;
    multagent: string;
};
export declare const getCliPromptPath: () => any;
export declare const CHAT_CONST: {
    DEFAULT_NAME: string;
};
