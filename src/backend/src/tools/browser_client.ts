import * as https from 'https';
import { URL } from 'url';
import { parse as htmlParse } from 'node-html-parser';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from '../utils/logger';
import puppeteer, {
    Browser,
    Page,
    ScreenshotOptions,
    Viewport,
    CookieParam,
    Protocol
} from 'puppeteer';
import globalAgent from 'global-agent';

// --- 初始化全局代理 (必须在所有HTTP请求之前) ---
function bootstrapGlobalProxy(): void {
    // 从环境变量获取代理地址
    const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || 
                     process.env.http_proxy || process.env.HTTP_PROXY ||
                     process.env.ALL_PROXY || process.env.all_proxy;
    
    if (proxyUrl) {
        // 设置全局代理环境变量
        process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
        logger.log(`Global proxy bootstrapped: ${proxyUrl}`);
    }
    
    // 初始化 global-agent (自动让所有 HTTP/HTTPS 请求使用代理)
    (globalAgent as any).bootstrap();
}

// 立即执行 bootstrap (模块加载时)
try {
    bootstrapGlobalProxy();
} catch (e) {
    logger.warn('Global proxy bootstrap failed, falling back to per-request agent');
}

// --- 代理配置工具函数 ---
function getProxyUrl(): string | undefined {
    return process.env.https_proxy || process.env.HTTPS_PROXY || 
           process.env.http_proxy || process.env.HTTP_PROXY ||
           process.env.ALL_PROXY || process.env.all_proxy;
}

function getProxyAgent(): https.Agent | undefined {
    const proxyUrl = getProxyUrl();
    if (proxyUrl) {
        try {
            return new HttpsProxyAgent(proxyUrl);
        } catch (e) {
            logger.warn('Failed to create proxy agent:', e);
            return undefined;
        }
    }
    return undefined;
}

function getChromeProxyArgs(): string[] {
    const proxyUrl = getProxyUrl();
    if (proxyUrl) {
        // 转换 http://... 格式为 Chrome 支持的格式
        // Chrome 支持: protocol://host:port
        const cleanProxy = proxyUrl.replace(/^https?:\/\//i, '');
        return [`--proxy-server=${cleanProxy}`];
    }
    return [];
}

// ==========================================
// 类型与接口定义 (Types & Interfaces)
// ==========================================

export interface ToolResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    [key: string]: any; // 允许附加错误信息等扩展字段
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
        x: number; y: number; width: number; height: number;
        top: number; right: number; bottom: number; left: number;
    };
    styles?: Record<string, string>;
    isVisible?: boolean;
}

// ==========================================
// BrowserController 核心控制类
// ==========================================

class BrowserController {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private isOpen: boolean = false;

    async openBrowser(options: BrowserOptions = {}): Promise<ToolResponse> {
        if (this.isOpen) {
            return { success: true, message: '浏览器已经打开' };
        }

        try {
            logger.log('正在启动浏览器...');
            
            // 获取代理参数
            const proxyArgs = getChromeProxyArgs();
            if (proxyArgs.length > 0) {
                logger.log(`使用浏览器代理: ${proxyArgs.join(', ')}`);
            }
            
            this.browser = await puppeteer.launch({
                headless: false,
                devtools: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    `--window-size=${options.width || 1200},${options.height || 800}`,
                    ...proxyArgs
                ],
                defaultViewport: {
                    width: options.width || 1200,
                    height: options.height || 800
                }
            });

            this.page = await this.browser.newPage();

            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            });

            this.setupEventListeners();

            this.isOpen = true;
            logger.log('浏览器启动成功');

            return { success: true, message: '浏览器启动成功' };
        } catch (error: any) {
            console.error('启动浏览器失败:', error);
            return { success: false, message: `启动浏览器失败: ${error.message}` };
        }
    }

    async closeBrowser(): Promise<ToolResponse> {
        if (!this.isOpen || !this.browser) {
            return { success: true, message: '浏览器已经关闭' };
        }

        try {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isOpen = false;

            logger.log('浏览器关闭成功');
            return { success: true, message: '浏览器关闭成功' };
        } catch (error: any) {
            console.error('关闭浏览器失败:', error);
            return { success: false, message: `关闭浏览器失败: ${error.message}` };
        }
    }

    async navigateToUrl(url: string, options: NavigationOptions = {}): Promise<ToolResponse> {
        if (!this.isOpen || !this.page) {
            return { success: false, message: '浏览器未打开，请先调用 openBrowser' };
        }

        try {
            logger.log(`正在导航到: ${url}`);

            if (options.blockJavaScript) {
                await this.page.setRequestInterception(true);
                this.page.on('request', (request) => {
                    if (request.resourceType() === 'script') {
                        request.abort();
                    } else {
                        request.continue();
                    }
                });
            }

            await this.page.goto(url, {
                waitUntil: options.waitUntil || 'networkidle2',
                timeout: options.timeout || 60000
            });

            if (options.waitAfterLoad) {
                await new Promise(resolve => setTimeout(resolve, options.waitAfterLoad));
            }

            if (options.blockJavaScript) {
                await this.page.setRequestInterception(false);
            }

            const pageInfo = await this.page.evaluate(() => ({
                title: document.title,
                url: window.location.href,
                readyState: document.readyState
            }));

            logger.log(`导航完成: ${pageInfo.title}`);

            return { success: true, message: '导航成功', data: pageInfo };
        } catch (error: any) {
            console.error(`导航到 ${url} 失败:`, error);
            if (options.blockJavaScript && this.page) {
                await this.page.setRequestInterception(false).catch(() => { });
            }
            return { success: false, message: `导航失败: ${error.message}`, url: url };
        }
    }

    async executeJavaScript(jsCode: string, options: ExecuteJsOptions = {}): Promise<ToolResponse> {
        if (!this.isOpen || !this.page) {
            return { success: false, message: '浏览器未打开，请先调用 openBrowser' };
        }

        try {
            logger.log('执行JavaScript代码...');

            const executionResult = await this.page.evaluate((code: string) => {
                const executionContext: any = {
                    startTime: new Date().toISOString(),
                    pageInfoBefore: {
                        title: document.title,
                        url: window.location.href,
                        readyState: document.readyState
                    },
                    result: null,
                    error: null,
                    success: true
                };

                try {
                    // eslint-disable-next-line no-eval
                    executionContext.result = eval(code);
                } catch (error: any) {
                    executionContext.success = false;
                    executionContext.error = {
                        message: error.message,
                        stack: error.stack,
                        name: error.name
                    };
                }

                executionContext.endTime = new Date().toISOString();
                executionContext.pageInfoAfter = {
                    title: document.title,
                    url: window.location.href,
                    readyState: document.readyState
                };

                return executionContext;
            }, jsCode);

            if (options.waitAfterExecution) {
                await new Promise(resolve => setTimeout(resolve, options.waitAfterExecution));
            }

            logger.log('JavaScript执行完成');
            return { success: true, message: 'JavaScript执行完成', data: executionResult };
        } catch (error: any) {
            console.error('执行JavaScript失败:', error);
            return { success: false, message: `执行JavaScript失败: ${error.message}` };
        }
    }

    async executePuppeteerAction(action: string, params: PuppeteerActionParams): Promise<ToolResponse> {
        if (!this.isOpen || !this.page) {
            return { success: false, message: '浏览器未打开，请先调用 openBrowser' };
        }

        try {
            logger.log(`执行Puppeteer操作: ${action}`);

            let result: any = null;
            const startTime = new Date().toISOString();

            switch (action) {
                case 'click':
                    await this.page.click(params.selector!, {
                        delay: params.delay || 0,
                        button: params.button || 'left',
                        clickCount: params.clickCount || 1
                    });
                    result = { selector: params.selector, action: 'click' };
                    break;

                case 'type':
                    await this.page.type(params.selector!, params.text!, {
                        delay: params.delay || 0
                    });
                    result = { selector: params.selector, text: params.text, action: 'type' };
                    break;

                case 'focus':
                    await this.page.focus(params.selector!);
                    result = { selector: params.selector, action: 'focus' };
                    break;

                case 'hover':
                    await this.page.hover(params.selector!);
                    result = { selector: params.selector, action: 'hover' };
                    break;

                case 'select':
                    const selectResult = await this.page.select(params.selector!, ...(params.values || []));
                    result = { selector: params.selector, values: params.values, selectedOptions: selectResult, action: 'select' };
                    break;

                case 'waitForSelector':
                    await this.page.waitForSelector(params.selector!, {
                        timeout: params.timeout || 30000,
                        visible: params.visible || false,
                        hidden: params.hidden || false
                    });
                    result = { selector: params.selector, action: 'waitForSelector' };
                    break;

                case 'waitForNavigation':
                    await this.page.waitForNavigation({
                        timeout: params.timeout || 30000,
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'waitForNavigation' };
                    break;

                case 'screenshot':
                    const screenshotOpts: ScreenshotOptions = {
                        path: params.path as any, // 绕过模板字符串类型检查
                        type: params.type || 'png',
                        quality: params.quality,
                        fullPage: params.fullPage || false
                    };
                    const screenshot = await this.page.screenshot(screenshotOpts);
                    result = {
                        action: 'screenshot',
                        type: params.type || 'png',
                        fullPage: params.fullPage || false,
                        // 将 Uint8Array 转换为 Base64 字符串
                        data: Buffer.from(screenshot).toString('base64') 
                    };
                    break;

                case 'scroll':
                    await this.page.evaluate((scrollParams: any) => {
                        if (scrollParams.selector) {
                            const element = document.querySelector(scrollParams.selector);
                            if (element) {
                                element.scrollIntoView(scrollParams.behavior === 'smooth');
                            }
                        } else {
                            window.scrollBy(scrollParams.x || 0, scrollParams.y || 0);
                        }
                    }, params);
                    result = { action: 'scroll', x: params.x, y: params.y, selector: params.selector };
                    break;

                case 'reload':
                    await this.page.reload({
                        timeout: params.timeout || 30000,
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'reload' };
                    break;

                case 'goBack':
                    await this.page.goBack({
                        timeout: params.timeout || 30000,
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'goBack' };
                    break;

                case 'goForward':
                    await this.page.goForward({
                        timeout: params.timeout || 30000,
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'goForward' };
                    break;

                case 'evaluate':
                    const evalFunc = typeof params.function === 'string'
                        ? new Function(`return (${params.function})()`) as any
                        : params.function!;
                    const evaluateResult = await this.page.evaluate(evalFunc, ...(params.args || []));
                    result = { action: 'evaluate', result: evaluateResult };
                    break;

                case 'waitForFunction':
                    const waitFunc = typeof params.function === 'string'
                        ? params.function
                        : (params.function as unknown as string);
                    await this.page.waitForFunction(waitFunc, {
                        timeout: params.timeout || 30000,
                        polling: params.polling
                    }, ...(params.args || []));
                    result = { action: 'waitForFunction' };
                    break;

                case 'setViewport':
                    await this.page.setViewport(params.viewport!);
                    result = { action: 'setViewport', viewport: params.viewport };
                    break;

                case 'setUserAgent':
                    await this.page.setUserAgent(params.userAgent!);
                    result = { action: 'setUserAgent', userAgent: params.userAgent };
                    break;

                case 'setCookie':
                    await this.page.setCookie(...(params.cookies || []));
                    result = { action: 'setCookie', cookies: params.cookies };
                    break;

                case 'deleteCookie':
                    if (params.name) {
                        const cookies = await this.page.cookies();
                        const cookieToDelete = cookies.find(c => c.name === params.name);
                        if (cookieToDelete) {
                            await this.page.deleteCookie(cookieToDelete);
                        }
                    } else if (params.cookies) {
                        await this.page.deleteCookie(...params.cookies);
                    }
                    result = { action: 'deleteCookie', name: params.name, cookies: params.cookies };
                    break;

                case 'clearCache':
                    const client = await this.page.target().createCDPSession();
                    await client.send('Network.clearBrowserCache');
                    result = { action: 'clearCache' };
                    break;

                case 'clearCookies':
                    const allCookies = await this.page.cookies();
                    await this.page.deleteCookie(...allCookies);
                    result = { action: 'clearCookies', deletedCount: allCookies.length };
                    break;

                default:
                    return {
                        success: false,
                        message: `不支持的Puppeteer操作: ${action}`,
                        supportedActions: [
                            'click', 'type', 'focus', 'hover', 'select',
                            'waitForSelector', 'waitForNavigation', 'screenshot',
                            'scroll', 'reload', 'goBack', 'goForward', 'evaluate',
                            'waitForFunction', 'setViewport', 'setUserAgent',
                            'setCookie', 'deleteCookie', 'clearCache', 'clearCookies'
                        ]
                    };
            }

            if (params.waitAfterAction) {
                await new Promise(resolve => setTimeout(resolve, params.waitAfterAction));
            }

            const endTime = new Date().toISOString();
            const pageInfo = await this.page.evaluate(() => ({
                title: document.title,
                url: window.location.href,
                readyState: document.readyState
            }));

            logger.log(`Puppeteer操作 ${action} 执行完成`);

            return {
                success: true,
                message: `Puppeteer操作 ${action} 执行成功`,
                data: {
                    action: action,
                    result: result,
                    pageInfo: pageInfo,
                    timing: { startTime, endTime }
                }
            };

        } catch (error: any) {
            console.error(`执行Puppeteer操作 ${action} 失败:`, error);
            return {
                success: false,
                message: `执行Puppeteer操作失败: ${error.message}`,
                action: action,
                params: params
            };
        }
    }

    async getElementInfo(selector: string): Promise<ToolResponse<ElementInfoData>> {
        if (!this.isOpen || !this.page) {
            return { success: false, message: '浏览器未打开' };
        }

        try {
            const elementInfo = await this.page.evaluate((sel: string): ElementInfoData => {
                const element = document.querySelector(sel);
                if (!element) {
                    return { exists: false };
                }

                const rect = element.getBoundingClientRect();
                const styles = window.getComputedStyle(element);
                
                const attributes: Record<string, string> = {};
                for (let i = 0; i < element.attributes.length; i++) {
                    const attr = element.attributes[i];
                    attributes[attr.name] = attr.value;
                }

                return {
                    exists: true,
                    tagName: element.tagName,
                    id: element.id,
                    className: element.className,
                    textContent: element.textContent?.substring(0, 200),
                    innerHTML: element.innerHTML?.substring(0, 500),
                    attributes: attributes,
                    boundingBox: {
                        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left
                    },
                    styles: {
                        display: styles.display,
                        visibility: styles.visibility,
                        opacity: styles.opacity,
                        position: styles.position,
                        zIndex: styles.zIndex
                    },
                    isVisible: rect.width > 0 && rect.height > 0 &&
                        styles.display !== 'none' &&
                        styles.visibility !== 'hidden' &&
                        styles.opacity !== '0'
                };
            }, selector);

            return { success: true, message: '获取元素信息成功', data: elementInfo };
        } catch (error: any) {
            console.error('获取元素信息失败:', error);
            return { success: false, message: `获取元素信息失败: ${error.message}` };
        }
    }

    async getPageStatus(): Promise<ToolResponse<PageInfo>> {
        if (!this.isOpen || !this.page) {
            return { success: false, message: '浏览器未打开' };
        }

        try {
            const pageInfo = await this.page.evaluate((): PageInfo => ({
                title: document.title,
                url: window.location.href,
                readyState: document.readyState,
                contentLength: document.documentElement.outerHTML.length,
                textLength: document.body.textContent?.length || 0
            }));

            return { success: true, message: '获取页面状态成功', data: pageInfo };
        } catch (error: any) {
            console.error('获取页面状态失败:', error);
            return { success: false, message: `获取页面状态失败: ${error.message}` };
        }
    }

    private setupEventListeners() {
        if (!this.page) return;

        this.page.on('console', msg => {
            logger.log('浏览器控制台:', msg.type(), msg.text());
        });

        this.page.on('pageerror', error => {
            logger.log('页面错误:', error);
        });

        this.page.on('requestfailed', request => {
            logger.log('请求失败:', request.url(), request.failure()?.errorText);
        });
    }

    getBrowserStatus() {
        return {
            isOpen: this.isOpen,
            timestamp: new Date().toISOString()
        };
    }
}

// ==========================================
// ContentExtractor 门面类
// ==========================================

export class ContentExtractor {
    private static instance: ContentExtractor | null = null;
    private browser!: BrowserController;
    private isBrowserOpen: boolean = false;

    constructor() {
        if (!ContentExtractor.instance) {
            this.browser = new BrowserController();
            ContentExtractor.instance = this;
        }
        return ContentExtractor.instance;
    }

    async main(params: Record<string, any>): Promise<ToolResponse> {
        const { operation, ...operationParams } = params;

        try {
            switch (operation) {
                case 'open':
                    return await this.openBrowser(operationParams);
                case 'close':
                    return await this.closeBrowser();
                case 'navigate':
                    return await this.navigate(operationParams);
                case 'execute_js':
                    return await this.executeJavaScript(operationParams);
                case 'get_content':
                    return await this.getPageContent(operationParams);
                case 'puppeteer_action':
                    return await this.executePuppeteerAction(operationParams as any);
                case 'get_element_info':
                    return await this.getElementInfo(operationParams);
                default:
                    return {
                        success: false,
                        message: `不支持的操作: ${operation}`,
                        supported_operations: [
                            'open', 'close', 'navigate', 'execute_js', 'get_content',
                            'puppeteer_action', 'get_element_info'
                        ]
                    };
            }
        } catch (error: any) {
            console.error(`执行操作 ${operation} 时发生错误:`, error);
            return {
                success: false,
                message: `操作执行失败: ${error.message}`,
                operation: operation
            };
        }
    }

    private async openBrowser(options: BrowserOptions = {}): Promise<ToolResponse> {
        await this.browser.closeBrowser();
        const result = await this.browser.openBrowser(options);
        if (result.success) {
            this.isBrowserOpen = true;
        }
        return result;
    }

    private async closeBrowser(): Promise<ToolResponse> {
        const result = await this.browser.closeBrowser();
        if (result.success) {
            this.isBrowserOpen = false;
        }
        return result;
    }

    private async navigate(params: any): Promise<ToolResponse> {
        const { url, wait_after_load, block_javascript, timeout, waitUntil } = params;

        if (!url) {
            return { success: false, message: '导航需要提供 url 参数' };
        }
        if (!this.isBrowserOpen) {
            return { success: false, message: '浏览器未打开，请先执行 open 操作' };
        }

        return await this.browser.navigateToUrl(url, {
            waitAfterLoad: wait_after_load || params.waitAfterLoad,
            blockJavaScript: block_javascript || params.blockJavaScript,
            timeout: timeout,
            waitUntil: waitUntil
        });
    }

    private async executeJavaScript(params: any): Promise<ToolResponse> {
        const { js, wait_after_execution = 1000 } = params;

        if (!js) {
            return { success: false, message: '执行JavaScript需要提供 js 参数' };
        }
        if (!this.isBrowserOpen) {
            return { success: false, message: '浏览器未打开，请先执行 open 操作' };
        }

        return await this.browser.executeJavaScript(js, {
            waitAfterExecution: wait_after_execution
        });
    }

    private async executePuppeteerAction(params: PuppeteerActionParams): Promise<ToolResponse> {
        const { action, waitAfterAction = 1000, wait_after_action, ...actionParams } = params as any;
        const targetWait = wait_after_action || waitAfterAction;

        if (!action) {
            return { success: false, message: '执行Puppeteer操作需要提供 action 参数' };
        }
        if (!this.isBrowserOpen) {
            return { success: false, message: '浏览器未打开，请先执行 open 操作' };
        }

        return await this.browser.executePuppeteerAction(action, {
            ...actionParams,
            waitAfterAction: targetWait
        });
    }

    private async getElementInfo(params: any): Promise<ToolResponse> {
        const { selector } = params;

        if (!selector) {
            return { success: false, message: '获取元素信息需要提供 selector 参数' };
        }
        if (!this.isBrowserOpen) {
            return { success: false, message: '浏览器未打开，请先执行 open 操作' };
        }

        return await this.browser.getElementInfo(selector);
    }

    private async getPageContent(params: ContentExtractionOptions): Promise<ToolResponse> {
        const action = params.action || 'extractText';
        const url = params.url;
        const maxLength = params.max_length || params.maxLength || 10240;
        const blockJavaScript = params.block_javascript || false;

        if (!this.isBrowserOpen) {
            return { success: false, message: '浏览器未打开，请先执行 open 操作' };
        }

        if (url) {
            const navResult = await this.browser.navigateToUrl(url, {
                waitAfterLoad: 2000,
                blockJavaScript: blockJavaScript
            });
            if (!navResult.success) {
                return navResult;
            }
        }

        try {
            let contentResult;

            switch (action) {
                case 'extractHTML':
                    contentResult = await this.extractHTML({
                        maxLength: maxLength,
                        removeSelectors: params.remove_selectors || params.removeSelectors
                    });
                    break;
                case 'extractText':
                    contentResult = await this.extractText({
                        maxLength: maxLength,
                        removeSelectors: params.remove_selectors || params.removeSelectors
                    });
                    break;
                case 'regexMatch':
                    const pattern = params.regex_pattern || params.regexPattern;
                    if (!pattern) {
                        return { success: false, message: '正则匹配需要提供 regex_pattern 参数' };
                    }
                    contentResult = await this.regexMatch({
                        regexPattern: pattern,
                        regexFlags: params.regex_flags || params.regexFlags || 'gi',
                        maxLength: maxLength,
                        removeSelectors: params.remove_selectors || params.removeSelectors,
                        contentType: params.content_type || params.contentType || 'text'
                    });
                    break;
                default:
                    return {
                        success: false,
                        message: `不支持的行为: ${action}`,
                        supported_actions: ['extractHTML', 'extractText', 'regexMatch']
                    };
            }

            const pageStatus = await this.browser.getPageStatus();

            return {
                success: true,
                message: `${action} 操作完成`,
                data: {
                    action: action,
                    page_info: pageStatus.success ? pageStatus.data : null,
                    content: contentResult,
                    block_javascript: blockJavaScript
                }
            };

        } catch (error: any) {
            return { success: false, message: `获取内容失败: ${error.message}`, action: action };
        }
    }

    private async extractHTML(options: ContentExtractionOptions = {}): Promise<any> {
        const removeSelectors = options.removeSelectors || [
            'script', 'style', 'noscript', 'iframe', '.ad', '.advertisement', '.ads'
        ];
        const maxLength = options.maxLength || 10240;

        const jsCode = `
            (function() {
                const removeSelectors = ${JSON.stringify(removeSelectors)};
                const clone = document.documentElement.cloneNode(true);
                removeSelectors.forEach(selector => {
                    const elements = clone.querySelectorAll(selector);
                    elements.forEach(element => element.remove());
                });
                const html = clone.outerHTML;
                const maxLength = ${maxLength};
                return {
                    content: html.substring(0, maxLength),
                    original_length: html.length,
                    truncated_length: Math.min(html.length, maxLength),
                    is_truncated: html.length > maxLength,
                    type: 'html'
                };
            })()
        `;

        const result = await this.browser.executeJavaScript(jsCode);
        if (result.success) {
            return result.data.result;
        } else {
            throw new Error(`提取HTML失败: ${result.message}`);
        }
    }

    private async extractText(options: ContentExtractionOptions = {}): Promise<any> {
        const removeSelectors = options.removeSelectors || [
            'script', 'style', 'noscript', 'iframe', 'nav', 'header', 'footer',
            '.ad', '.advertisement', '.ads', '.sidebar', '.menu', '.navigation'
        ];
        const maxLength = options.maxLength || 10240;

        const jsCode = `
            (function() {
                const removeSelectors = ${JSON.stringify(removeSelectors)};
                const tempDocument = document.cloneNode(true);
                removeSelectors.forEach(selector => {
                    const elements = tempDocument.querySelectorAll(selector);
                    elements.forEach(element => element.remove());
                });
                
                const mainSelectors = [
                    'main', 'article', '.content', '.main-content',
                    '.post-content', '.entry-content', '[role="main"]'
                ];
                
                let mainContent = tempDocument.body;
                for (const selector of mainSelectors) {
                    const el = tempDocument.querySelector(selector);
                    if (el && el.textContent.length > 200) {
                        mainContent = el;
                        break;
                    }
                }
                
                const text = mainContent.textContent.replace(/\\s+/g, ' ').trim();
                const maxLength = ${maxLength};
                
                return {
                    content: text.substring(0, maxLength),
                    original_length: text.length,
                    truncated_length: Math.min(text.length, maxLength),
                    is_truncated: text.length > maxLength,
                    main_content_used: mainContent !== tempDocument.body,
                    type: 'text'
                };
            })()
        `;

        const result = await this.browser.executeJavaScript(jsCode);
        if (result.success) {
            return result.data.result;
        } else {
            throw new Error(`提取Text失败: ${result.message}`);
        }
    }

    private async regexMatch(options: ContentExtractionOptions = {}): Promise<any> {
        const contentType = options.contentType || 'text';
        let baseContent: any;

        if (contentType === 'html') {
            baseContent = await this.extractHTML(options);
        } else {
            baseContent = await this.extractText(options);
        }

        const jsCode = `
            (function() {
                const content = ${JSON.stringify(baseContent.content)};
                const pattern = ${JSON.stringify(options.regexPattern)};
                const flags = ${JSON.stringify(options.regexFlags || 'gi')};
                const contentType = ${JSON.stringify(contentType)};
                
                try {
                    const regex = new RegExp(pattern, flags);
                    const matches = [];
                    let match;
                    
                    while ((match = regex.exec(content)) !== null) {
                        matches.push({
                            match: match[0],
                            index: match.index,
                            groups: match.slice(1),
                            context: content.substring(
                                Math.max(0, match.index - 50), 
                                Math.min(content.length, match.index + match[0].length + 50)
                            )
                        });
                        if (match.index === regex.lastIndex) {
                            regex.lastIndex++;
                        }
                        if (matches.length >= 50) break;
                    }
                    
                    return {
                        pattern: pattern,
                        flags: flags,
                        content_type: contentType,
                        matches_found: matches.length,
                        matches: matches,
                        content_preview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
                        type: 'regex'
                    };
                } catch (error) {
                    return { error: error.toString(), pattern: pattern, flags: flags, content_type: contentType };
                }
            })()
        `;

        const result = await this.browser.executeJavaScript(jsCode);
        if (result.success) {
            const regexResult = result.data.result;
            if (regexResult.error) {
                throw new Error(`正则表达式错误: ${regexResult.error}`);
            }
            return { ...regexResult, base_content: baseContent };
        } else {
            throw new Error(`正则匹配失败: ${result.message}`);
        }
    }

    public getBrowserStatus() {
        return this.browser.getBrowserStatus();
    }
}

/**
 * 获取工具提示
 */
export function getPrompt() {
    return {
        "name": "browser_client",
        "description": "A high-level browser automation tool powered by Puppeteer. It can open pages, interact with elements, execute JavaScript, and extract cleaned content (HTML/Text) using selectors or regex.",
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["open", "close", "navigate", "execute_js", "get_content", "puppeteer_action", "get_element_info"],
                    "description": "The primary browser action to perform."
                },
                "url": {
                    "type": "string",
                    "description": "The URL to navigate to (used with 'navigate', 'get_content', or implicitly in 'open')."
                },
                "action": {
                    "type": "string",
                    "description": "Specific action type. For 'get_content': [extractHTML, extractText, regexMatch]. For 'puppeteer_action': [click, type, hover, scroll, screenshot, etc.]."
                },
                "selector": {
                    "type": "string",
                    "description": "CSS selector for element interaction or info extraction."
                },
                "js": {
                    "type": "string",
                    "description": "JavaScript code string to execute in the page context."
                },
                "regex_pattern": {
                    "type": "string",
                    "description": "Regex pattern to match content when action is 'regexMatch'."
                },
                "params": {
                    "type": "object",
                    "description": "Additional configuration for the operation.",
                    "properties": {
                        "width": { "type": "number", "default": 1200 },
                        "height": { "type": "number", "default": 800 },
                        "wait_after_action": { "type": "number", "description": "Wait time in ms after action" },
                        "block_javascript": { "type": "boolean", "description": "Block JS for faster loading" },
                        "remove_selectors": { "type": "array", "items": { "type": "string" }, "description": "Selectors to strip from content" }
                    }
                }
            },
            "required": ["operation"]
        }
    };
}

const extractor = new ContentExtractor();

export function main() {
    return async (params: Record<string, any>): Promise<ToolResponse> => {
        return await extractor.main(params);
    };
}

// ==========================================
// 测试模块
// ==========================================
if (require.main === module) {
    (async () => {
        try {
            logger.log('=== 测试内容提取器（支持Puppeteer原生操作）===\n');
            const testExtractor = new ContentExtractor();

            logger.log('1. 打开浏览器...');
            let result = await testExtractor.main({ operation: 'open' });
            logger.log('打开结果:', result.success ? '成功' : '失败');
            if (!result.success) return;

            logger.log('\n1.5. 单独测试 navigate 导航...');
            result = await testExtractor.main({
                operation: 'navigate',
                url: 'https://example.com'
            });
            logger.log('Navigate 结果:', result.success ? '成功' : '失败');

            logger.log('\n2. 获取页面内容...');
            result = await testExtractor.main({
                operation: 'get_content',
                action: 'extractText',
                block_javascript: true
            });
            logger.log('内容提取结果:', result.success ? '成功' : '失败');

            logger.log('\n3. 测试Puppeteer滚动操作...');
            result = await testExtractor.main({
                operation: 'puppeteer_action',
                action: 'scroll',
                y: 500,
                wait_after_action: 1000
            });
            logger.log('滚动操作:', result.success ? '成功' : '失败');

            logger.log('\n4. 测试获取元素信息...');
            result = await testExtractor.main({
                operation: 'get_element_info',
                selector: 'h1'
            });
            logger.log('元素信息:', result.success ? '成功' : '失败');
            if (result.success) {
                logger.log('元素存在:', result.data.exists);
            }

            logger.log('\n5. 测试截图操作...');
            result = await testExtractor.main({
                operation: 'puppeteer_action',
                action: 'screenshot',
                fullPage: false
            });
            logger.log('截图操作:', result.success ? '成功' : '失败');
            if (result.success) {
                logger.log('截图数据长度:', result.data.result.data.length);
            }

            logger.log('\n6. 关闭浏览器...');
            result = await testExtractor.main({ operation: 'close' });
            logger.log('关闭结果:', result.success ? '成功' : '失败');

        } catch (error) {
            console.error('测试错误:', error);
        }
    })();
}