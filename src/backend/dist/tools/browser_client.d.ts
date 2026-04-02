import { Viewport, CookieParam } from 'puppeteer';
export interface ToolResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    [key: string]: any;
}
export interface BrowserOptions {
    width?: number;
    height?: number;
}
export interface NavigationOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
    waitAfterLoad?: number;
    blockJavaScript?: boolean;
}
export interface ExecuteJsOptions {
    waitAfterExecution?: number;
}
export interface PuppeteerActionParams {
    action: string;
    selector?: string;
    text?: string;
    delay?: number;
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    values?: string[];
    timeout?: number;
    visible?: boolean;
    hidden?: boolean;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    path?: string;
    type?: 'png' | 'jpeg' | 'webp';
    quality?: number;
    fullPage?: boolean;
    x?: number;
    y?: number;
    behavior?: 'auto' | 'smooth';
    function?: string | ((...args: any[]) => any);
    args?: any[];
    polling?: 'raf' | 'mutation' | number;
    viewport?: Viewport;
    userAgent?: string;
    cookies?: CookieParam[];
    name?: string;
    waitAfterAction?: number;
}
export interface ContentExtractionOptions {
    action?: 'extractHTML' | 'extractText' | 'regexMatch';
    url?: string;
    max_length?: number;
    maxLength?: number;
    regex_pattern?: string;
    regexPattern?: string;
    regex_flags?: string;
    regexFlags?: string;
    remove_selectors?: string[];
    removeSelectors?: string[];
    content_type?: 'text' | 'html';
    contentType?: 'text' | 'html';
    block_javascript?: boolean;
}
export interface PageInfo {
    title: string;
    url: string;
    readyState: string;
    contentLength?: number;
    textLength?: number;
}
export interface ElementInfoData {
    exists: boolean;
    tagName?: string;
    id?: string;
    className?: string;
    textContent?: string;
    innerHTML?: string;
    attributes?: Record<string, string>;
    boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    styles?: Record<string, string>;
    isVisible?: boolean;
}
export declare class ContentExtractor {
    private static instance;
    private browser;
    private isBrowserOpen;
    constructor();
    main(params: Record<string, any>): Promise<ToolResponse>;
    private openBrowser;
    private closeBrowser;
    private navigate;
    private executeJavaScript;
    private executePuppeteerAction;
    private getElementInfo;
    private getPageContent;
    private extractHTML;
    private extractText;
    private regexMatch;
    getBrowserStatus(): {
        isOpen: boolean;
        timestamp: string;
    };
}
/**
 * 获取工具提示
 */
export declare function getPrompt(): {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            operation: {
                type: string;
                enum: string[];
                description: string;
            };
            url: {
                type: string;
                description: string;
            };
            action: {
                type: string;
                description: string;
            };
            selector: {
                type: string;
                description: string;
            };
            js: {
                type: string;
                description: string;
            };
            regex_pattern: {
                type: string;
                description: string;
            };
            params: {
                type: string;
                description: string;
                properties: {
                    width: {
                        type: string;
                        default: number;
                    };
                    height: {
                        type: string;
                        default: number;
                    };
                    wait_after_action: {
                        type: string;
                        description: string;
                    };
                    block_javascript: {
                        type: string;
                        description: string;
                    };
                    remove_selectors: {
                        type: string;
                        items: {
                            type: string;
                        };
                        description: string;
                    };
                };
            };
        };
        required: string[];
    };
};
export declare function main(): (params: Record<string, any>) => Promise<ToolResponse>;
