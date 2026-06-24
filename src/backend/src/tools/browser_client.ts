import { logger } from '../utils/logger';
import puppeteer, {
    Browser,
    Page,
    ScreenshotOptions,
    Viewport,
    CookieParam,
} from 'puppeteer';
import { ToolCall } from '../core/ToolCall';
import { isSilentMode } from '../utils/public';
import { bootstrapGlobalProxy } from '../utils/proxy';

// 初始化全局代理 (必须在所有HTTP请求之前)
bootstrapGlobalProxy();

// --- 代理配置工具函数 ---
function getProxyUrl(): string | undefined {
    return process.env.https_proxy || process.env.HTTPS_PROXY ||
        process.env.http_proxy || process.env.HTTP_PROXY ||
        process.env.ALL_PROXY || process.env.all_proxy;
}

function getChromeProxyArgs(): string[] {
    const proxyUrl = getProxyUrl();
    if (!proxyUrl) {
        return [];
    }

    const args: string[] = [];

    // 清理代理URL: 去协议、去尾部斜杠、去空白
    let cleanProxy = proxyUrl.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

    // 如果包含认证信息 user:pass@host:port，Chrome 不支持命令行认证
    // 检测并警告，但仍然尝试传递（某些代理服务器可能忽略认证）
    if (cleanProxy.includes('@')) {
        logger.log('警告: 代理URL包含认证信息，Chrome 可能无法正确处理');
    }

    args.push(`--proxy-server=${cleanProxy}`);

    // 解析 no_proxy 并传递给 Chrome
    const noProxy = process.env.no_proxy || process.env.NO_PROXY;
    if (noProxy) {
        // Chrome 的 --proxy-bypass-list 格式: 分号分隔，支持通配符和 CIDR
        // 转换 no_proxy (逗号分隔) → Chrome 格式
        const bypassList = noProxy
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => {
                // CIDR 格式保持不变 (Chrome 支持)
                if (s.includes('/')) return s;
                // <local> 在 Chrome 中表示所有不带点的域名
                return s === '<local>' ? s : s;
            })
            .join(';');
        args.push(`--proxy-bypass-list=${bypassList}`);
        logger.log(`Chrome 代理绕过列表: ${bypassList}`);
    }

    return args;
}

// --- Chrome/Headless Shell 路径检测 ---
function getChromeExecutablePath(): string | undefined {
    const fs = require('fs');
    const path = require('path');

    // 候选路径列表（按优先级排序）
    const candidates: string[] = [];

    // 跨平台二进制名称
    const binaryName = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';

    // 1) 系统 Chrome / Chromium（优先使用完整 Chrome，支持有头模式）
    const systemPaths = process.platform === 'linux'
        ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium']
        : process.platform === 'darwin'
            ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
            : ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
               'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];

    for (const p of systemPaths) {
        if (fs.existsSync(p)) {
            candidates.push(p);
        }
    }

    // 2) 打包后的 resources 目录 (Electron 生产环境) — headless-shell 降级
    // electron-builder 打包后, process.resourcesPath 指向 resources/
    const electronResourcesPath = (process as any).resourcesPath;
    if (electronResourcesPath) {
        const bundledDir = path.join(electronResourcesPath, 'chrome-headless-shell');
        if (fs.existsSync(bundledDir)) {
            // 查找 chrome-headless-shell 二进制
            const entries = fs.readdirSync(bundledDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // 平台目录 (如 linux-141.0.7390.54)
                    const platformDir = path.join(bundledDir, entry.name);
                    if (fs.existsSync(platformDir)) {
                        const subEntries = fs.readdirSync(platformDir, { withFileTypes: true });
                        for (const sub of subEntries) {
                            if (sub.isDirectory()) {
                                const exePath = path.join(platformDir, sub.name, binaryName);
                                if (fs.existsSync(exePath)) {
                                    candidates.push(exePath);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3) 开发环境: 项目根目录下的 resources/ — headless-shell 降级
    const devResourcesPath = path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'chrome-headless-shell');
    if (fs.existsSync(devResourcesPath)) {
        const entries = fs.readdirSync(devResourcesPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const platformDir = path.join(devResourcesPath, entry.name);
                if (fs.existsSync(platformDir)) {
                    const subEntries = fs.readdirSync(platformDir, { withFileTypes: true });
                    for (const sub of subEntries) {
                        if (sub.isDirectory()) {
                            const exePath = path.join(platformDir, sub.name, binaryName);
                            if (fs.existsSync(exePath)) {
                                candidates.push(exePath);
                            }
                        }
                    }
                }
            }
        }
    }

    if (candidates.length > 0) {
        // 选择第一个匹配的
        logger.log(`检测到 Chrome 路径: ${candidates[0]}`);
        return candidates[0];
    }

    // 4) 回退到 Puppeteer 默认行为 (~/.cache/puppeteer)
    logger.log('未找到系统或打包的 Chrome，回退到 Puppeteer 默认缓存路径');
    return undefined;
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
            // 检查静默模式
            const silentMode = isSilentMode();
            logger.log(silentMode ? '正在启动浏览器（静默模式）...' : '正在启动浏览器...');

            // 获取代理参数
            const proxyArgs = getChromeProxyArgs();
            if (proxyArgs.length > 0) {
                logger.log(`使用浏览器代理: ${proxyArgs.join(', ')}`);
            }

            // 检测可用的 Chrome/Headless Shell 路径
            const executablePath = getChromeExecutablePath();

            this.browser = await puppeteer.launch({
                headless: silentMode, // 静默模式下使用 headless 模式
                devtools: false,
                executablePath,       // 使用打包的 chrome-headless-shell 或系统 Chrome
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

            // 代理失败自动回退：如果错误与代理相关且有代理配置，尝试无代理重试
            const proxyUrl = getProxyUrl();
            const isProxyError = proxyUrl && (
                error.message?.includes('PROXY') ||
                error.message?.includes('proxy') ||
                error.message?.includes('ERR_TUNNEL_CONNECTION_FAILED')
            );

            if (isProxyError && this.page) {
                logger.log('检测到代理错误，尝试无代理重试...');
                try {
                    await this.page.goto(url, {
                        waitUntil: options.waitUntil || 'networkidle2',
                        timeout: options.timeout || 60000
                    });
                    // 重试成功，说明代理是问题所在
                    logger.log('无代理重试成功（代理不可用，已直连）');
                    const pageInfo = await this.page.evaluate(() => ({
                        title: document.title,
                        url: window.location.href,
                        readyState: document.readyState
                    }));
                    return { success: true, message: '导航成功（已绕过代理）', data: pageInfo };
                } catch (retryError: any) {
                    logger.log('无代理重试也失败');
                }
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

    private async executePuppeteerAction(params: PuppeteerActionParams & Record<string, any>): Promise<ToolResponse> {
        // 兼容两种调用方式：
        // 1) { action: 'type', selector: '#x', text: 'hello', ... }
        // 2) { action: 'type', params: { text: 'hello', selector: '#x', ... } }
        const raw = params as any;

        // 如果存在 params 子对象，将其中的参数提升到顶层
        // 合并策略：params 中的值作为默认值，顶层同名 key 优先（更安全）
        let mergedParams: Record<string, any>;
        if (raw.params && typeof raw.params === 'object') {
            mergedParams = { ...raw.params, ...raw };
        } else {
            mergedParams = raw;
        }

        const { action, waitAfterAction = 1000, wait_after_action, ...actionParams } = mergedParams;
        const targetWait = wait_after_action || waitAfterAction;

        if (!action) {
            return { success: false, message: '执行Puppeteer操作需要提供 action 参数' };
        }
        if (!this.isBrowserOpen) {
            return { success: false, message: '浏览器未打开，请先执行 open 操作' };
        }

        return await this.browser.executePuppeteerAction(action, actionParams as PuppeteerActionParams);
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
        "description": "A high-level browser automation tool powered by Puppeteer. It can open pages, interact with elements, execute JavaScript, and extract cleaned content (HTML/Text) using selectors or regex.\n\n🔑 PREFERRED FOR:\n• Web search via DuckDuckGo — navigate to https://duckduckgo.com, type queries into the search box, submit, and extract results. Use this when web_crawler_toolkit fails or returns no results.\n• PubMed literature search — navigate to https://pubmed.ncbi.nlm.nih.gov and search biomedical articles. The only reliable way to query PubMed from China without VPN.\n• Any website blocked at the API/HTTP level but accessible via browser.",
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
                    "description": "Additional parameters. For 'puppeteer_action' operations like 'type', 'click', 'hover', you can pass the inner action parameters here (e.g., params: { text: 'hello', delay: 100 }) OR pass them as top-level keys alongside 'action'.",
                    "properties": {
                        "width": { "type": "number", "default": 1200, "description": "Browser viewport width" },
                        "height": { "type": "number", "default": 800, "description": "Browser viewport height" },
                        "text": { "type": "string", "description": "Text to type (for 'type' puppeteer_action)" },
                        "delay": { "type": "number", "description": "Delay in ms between keystrokes (for 'type') or before click" },
                        "button": { "type": "string", "enum": ["left", "right", "middle"], "description": "Mouse button for click" },
                        "clickCount": { "type": "number", "description": "Number of clicks" },
                        "values": { "type": "array", "items": { "type": "string" }, "description": "Values for select action" },
                        "timeout": { "type": "number", "description": "Timeout in ms" },
                        "visible": { "type": "boolean", "description": "Wait for visible element" },
                        "hidden": { "type": "boolean", "description": "Wait for hidden element" },
                        "waitUntil": { "type": "string", "enum": ["load", "domcontentloaded", "networkidle0", "networkidle2"], "description": "Navigation wait condition" },
                        "path": { "type": "string", "description": "File path to save screenshot" },
                        "type": { "type": "string", "enum": ["png", "jpeg", "webp"], "description": "Screenshot format" },
                        "quality": { "type": "number", "description": "Screenshot quality (0-100)" },
                        "fullPage": { "type": "boolean", "description": "Full page screenshot" },
                        "x": { "type": "number", "description": "Horizontal scroll amount" },
                        "y": { "type": "number", "description": "Vertical scroll amount" },
                        "behavior": { "type": "string", "enum": ["auto", "smooth"], "description": "Scroll behavior" },
                        "viewport": { "type": "object", "description": "Viewport settings { width, height }" },
                        "userAgent": { "type": "string", "description": "Custom user agent string" },
                        "cookies": { "type": "array", "description": "Cookies to set" },
                        "name": { "type": "string", "description": "Cookie name to delete" },
                        "function": { "type": "string", "description": "Function string for evaluate/waitForFunction" },
                        "args": { "type": "array", "description": "Arguments for evaluate/waitForFunction" },
                        "polling": { "type": ["string", "number"], "description": "Polling interval for waitForFunction ('raf', 'mutation', or ms)" },
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

export function main(): (params: Record<string, any>) => Promise<ToolResponse> {
    return async (params: Record<string, any>): Promise<ToolResponse> => {
        return await extractor.main({ ...params, toolCall: ToolCall });
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