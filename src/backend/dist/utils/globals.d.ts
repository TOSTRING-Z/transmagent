import { Utils } from './Utils';
export declare const store: {
    set: (name: string, value: any) => void;
    get: (name: string, defaultValue?: any) => any;
};
export declare const CONSTANTS: {
    COLLECTION_URL: string;
    PLUGIN_MODEL_NAME: string;
};
export declare const sysConfig: {
    transagent: string;
    baseagent: string;
    multagent: string;
};
export declare const utils: Utils;
export declare const globalState: {
    config: any;
    last_clipboard_content: string | null;
    concat: boolean;
};
export declare const CHAT_CONST: {
    DEFAULT_NAME: string;
};
