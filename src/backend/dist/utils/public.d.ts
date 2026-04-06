export declare const hashCode: (str: string) => string;
export declare const extractJson: (text: string) => string | null;
export declare const parseJsonContent: (content: string) => any;
export declare const delay: (seconds: number) => Promise<void>;
export declare const getDefault: (name?: string) => string;
export declare const getSystem: (name?: string) => string;
export declare const getFile: (file_path: string) => string | null;
export declare const mergeConfigEnhanced: (defaultConfig: any, userConfig: any) => {
    mergedConfig: any;
    mismatches: any[];
    addedKeys: any[];
};
export declare const getLanguage: () => string;
export declare const formatDate: () => string;
export declare const copy: <T>(data: T) => T;
export declare const getSessionId: () => string;
