import { logger } from '../utils/logger';
const puppeteer = require('puppeteer');

class BrowserController {
    browser: any;
    page: any;
    isOpen: boolean;
    timeout: any;
    defaultViewport: any;
    width: number = 1200;
    height: number = 800;

    constructor() {
// @ts-ignore
// @ts-ignore
        this.browser = null;
// @ts-ignore
        this.page = null;
// @ts-ignore
        this.isOpen = false;
    }

    /**
     * 打开浏览器
     */
    async openBrowser(options: { width?: number; height?: number } = {} as any) {
// @ts-ignore
        if (this.isOpen) {
// @ts-ignore
// @ts-ignore
            return { success: true, message: '浏览器已经打开' };
        }

        try {
            logger.log('正在启动浏览器...');
// @ts-ignore
// @ts-ignore
            this.browser = await puppeteer.launch({
                headless: false,
                devtools: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--window-size=1200,800'
                ],
                defaultViewport: {
// @ts-ignore
                    width: options.width || 1200,
// @ts-ignore
                    height: options.height || 800
                }
            });

// @ts-ignore
// @ts-ignore
            this.page = await this.browser.newPage();

            // 设置浏览器环境
// @ts-ignore
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
// @ts-ignore
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            });

            // 设置事件监听
            this.setupEventListeners();

// @ts-ignore
            this.isOpen = true;
            logger.log('浏览器启动成功');

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: '浏览器启动成功'
            };

        } catch (error: any) {
            console.error('启动浏览器失败:', error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `启动浏览器失败: ${(error as Error).message}`
            };
        }
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser() {
// @ts-ignore
        if (!this.isOpen) {
// @ts-ignore
// @ts-ignore
            return { success: true, message: '浏览器已经关闭' };
        }

        try {
// @ts-ignore
// @ts-ignore
// @ts-ignore
            await this.browser.close();
// @ts-ignore
// @ts-ignore
            this.browser = null;
// @ts-ignore
            this.page = null;
// @ts-ignore
            this.isOpen = false;

            logger.log('浏览器关闭成功');
// @ts-ignore
// @ts-ignore
            return { success: true, message: '浏览器关闭成功' };

        } catch (error: any) {
            console.error('关闭浏览器失败:', error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `关闭浏览器失败: ${(error as Error).message}`
            };
        }
    }

    /**
     * 跳转到指定URL
     */
    async navigateToUrl(url, options: any = {} as any) {
// @ts-ignore
        if (!this.isOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先调用 openBrowser'
            };
        }

        try {
            logger.log(`正在导航到: ${url}`);

            // 设置拦截器来阻止 JavaScript 加载
// @ts-ignore
            if (options.blockJavaScript) {
// @ts-ignore
                await this.page.setRequestInterception(true);
// @ts-ignore
                this.page.on('request', (request) => {
                    if (request.resourceType() === 'script') {
                        request.abort();
                    } else {
                        request.continue();
                    }
                });
            }

            const navigationOptions = {
// @ts-ignore
                waitUntil: options.waitUntil || 'networkidle2',
// @ts-ignore
                timeout: options.timeout || 60000
            };

// @ts-ignore
            await this.page.goto(url, navigationOptions);

            // 等待页面加载
// @ts-ignore
            if (options.waitAfterLoad) {
// @ts-ignore
                await new Promise(resolve => setTimeout(resolve, options.waitAfterLoad));
            }

            // 恢复请求拦截
// @ts-ignore
            if (options.blockJavaScript) {
// @ts-ignore
                await this.page.setRequestInterception(false);
            }

// @ts-ignore
            const pageInfo = await this.page.evaluate(() => ({
// @ts-ignore
                title: document.title,
                url: window.location.href,
// @ts-ignore
                readyState: document.readyState
            }));

            logger.log(`导航完成: ${pageInfo.title}`);

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: '导航成功',
                data: pageInfo
            };

        } catch (error: any) {
            console.error(`导航到 ${url} 失败:`, error);
            // 确保在出错时也恢复请求拦截
// @ts-ignore
            if (options.blockJavaScript) {
// @ts-ignore
                await this.page.setRequestInterception(false).catch(() => { });
            }
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `导航失败: ${(error as Error).message}`,
                url: url
            };
        }
    }

    /**
     * 执行JavaScript代码
     */
    async executeJavaScript(jsCode, options = {} as any) {
// @ts-ignore
        if (!this.isOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先调用 openBrowser'
            };
        }

        try {
            logger.log('执行JavaScript代码...');

// @ts-ignore
            const executionResult = await this.page.evaluate((code) => {
                const executionContext = {
                    startTime: new Date().toISOString(),
                    pageInfoBefore: {
// @ts-ignore
                        title: document.title,
                        url: window.location.href,
// @ts-ignore
                        readyState: document.readyState
                    },
// @ts-ignore
                    result: any,
                    error: null,
                    success: true
                };

                try {
                    executionContext.result = eval(code);
                } catch (error: any) {
                    executionContext.success = false;
                    // @ts-ignore
                    executionContext.error = {
                        message: (error as Error).message,
                        stack: error.stack,
                        name: error.name
                    };
                }

                // @ts-ignore
                executionContext.endTime = new Date().toISOString();

                // 获取执行后的页面状态
                // @ts-ignore
                executionContext.pageInfoAfter = {
// @ts-ignore
                    title: document.title,
                    url: window.location.href,
// @ts-ignore
                    readyState: document.readyState
                };

                return executionContext;
            }, jsCode);

            // 等待执行后的效果
// @ts-ignore
            if (options.waitAfterExecution) {
// @ts-ignore
                await new Promise(resolve => setTimeout(resolve, options.waitAfterExecution));
            }

            logger.log('JavaScript执行完成');

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: 'JavaScript执行完成',
                data: executionResult
            };

        } catch (error: any) {
            console.error('执行JavaScript失败:', error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `执行JavaScript失败: ${(error as Error).message}`
            };
        }
    }

    /**
     * 执行Puppeteer原生操作
     */
    async executePuppeteerAction(action, params = {} as any) {
// @ts-ignore
        if (!this.isOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先调用 openBrowser'
            };
        }

        try {
            logger.log(`执行Puppeteer操作: ${action}`);

            let result: any = null;
            const startTime = new Date().toISOString();

            switch (action) {
                case 'click':
// @ts-ignore
// @ts-ignore
                    await this.page.click(params.selector, {
// @ts-ignore
                        delay: params.delay || 0,
// @ts-ignore
                        button: params.button || 'left',
// @ts-ignore
                        clickCount: params.clickCount || 1
                    });
// @ts-ignore
                    result = { selector: params.selector, action: 'click' };
                    break;

                case 'type':
// @ts-ignore
// @ts-ignore
                    await this.page.type(params.selector, params.text, {
// @ts-ignore
                        delay: params.delay || 0
                    });
                    result = {
// @ts-ignore
                        selector: params.selector,
// @ts-ignore
                        text: params.text,
                        action: 'type'
                    };
                    break;

                case 'focus':
// @ts-ignore
// @ts-ignore
                    await this.page.focus(params.selector);
// @ts-ignore
                    result = { selector: params.selector, action: 'focus' };
                    break;

                case 'hover':
// @ts-ignore
// @ts-ignore
                    await this.page.hover(params.selector);
// @ts-ignore
                    result = { selector: params.selector, action: 'hover' };
                    break;

                case 'select': {
// @ts-ignore
// @ts-ignore
                    const selectResult = await this.page.select(params.selector, params.values);
                    result = {
// @ts-ignore
                        selector: params.selector,
// @ts-ignore
                        values: params.values,
                        selectedOptions: selectResult,
                        action: 'select'
                    };
                    break;
                }

                case 'waitForSelector':
// @ts-ignore
// @ts-ignore
                    await this.page.waitForSelector(params.selector, {
// @ts-ignore
                        timeout: params.timeout || 30000,
// @ts-ignore
                        visible: params.visible || false,
// @ts-ignore
                        hidden: params.hidden || false
                    });
// @ts-ignore
                    result = { selector: params.selector, action: 'waitForSelector' };
                    break;

                case 'waitForNavigation':
// @ts-ignore
                    await this.page.waitForNavigation({
// @ts-ignore
                        timeout: params.timeout || 30000,
// @ts-ignore
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'waitForNavigation' };
                    break;

                case 'screenshot': {
// @ts-ignore
                    const screenshot = await this.page.screenshot({
// @ts-ignore
                        path: params.path,
// @ts-ignore
                        type: params.type || 'png',
// @ts-ignore
                        quality: params.quality,
// @ts-ignore
                        fullPage: params.fullPage || false
                    });
                    result = {
                        action: 'screenshot',
// @ts-ignore
                        type: params.type || 'png',
// @ts-ignore
                        fullPage: params.fullPage || false,
                        data: screenshot.toString('base64')
                    };
                    break;
                }

                case 'scroll':
// @ts-ignore
                    await this.page.evaluate((scrollParams) => {
                        if (scrollParams.selector) {
// @ts-ignore
                            const element = document.querySelector(scrollParams.selector);
                            if (element) {
                                element.scrollIntoView(scrollParams.behavior === 'smooth');
                            }
                        } else {
                            window.scrollBy(scrollParams.x || 0, scrollParams.y || 0);
                        }
                    }, params);
                    result = {
                        action: 'scroll',
// @ts-ignore
                        x: params.x,
// @ts-ignore
                        y: params.y,
// @ts-ignore
                        selector: params.selector
                    };
                    break;

                case 'reload':
// @ts-ignore
                    await this.page.reload({
// @ts-ignore
                        timeout: params.timeout || 30000,
// @ts-ignore
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'reload' };
                    break;

                case 'goBack':
// @ts-ignore
                    await this.page.goBack({
// @ts-ignore
                        timeout: params.timeout || 30000,
// @ts-ignore
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'goBack' };
                    break;

                case 'goForward':
// @ts-ignore
                    await this.page.goForward({
// @ts-ignore
                        timeout: params.timeout || 30000,
// @ts-ignore
                        waitUntil: params.waitUntil || 'load'
                    });
                    result = { action: 'goForward' };
                    break;

                case 'evaluate': {
// @ts-ignore
// @ts-ignore
// @ts-ignore
                    const evaluateResult = await this.page.evaluate(params.function, ...(params.args || []));
                    result = {
                        action: 'evaluate',
// @ts-ignore
                        result: evaluateResult
                    };
                    break;
                }

                case 'waitForFunction':
// @ts-ignore
// @ts-ignore
// @ts-ignore
                    await this.page.waitForFunction(params.function, {
// @ts-ignore
                        timeout: params.timeout || 30000,
// @ts-ignore
                        polling: params.polling
// @ts-ignore
                    }, ...(params.args || []));
                    result = { action: 'waitForFunction' };
                    break;

                case 'setViewport':
// @ts-ignore
                    await this.page.setViewport(params.viewport);
                    result = {
                        action: 'setViewport',
                        // @ts-ignore
                        viewport: params.viewport
                    };
                    break;

                case 'setUserAgent':
// @ts-ignore
                    await this.page.setUserAgent(params.userAgent);
                    result = {
                        action: 'setUserAgent',
                        // @ts-ignore
                        userAgent: params.userAgent
                    };
                    break;

                case 'setCookie':
// @ts-ignore
                    await this.page.setCookie(...(params.cookies || []));
                    result = {
                        action: 'setCookie',
                        // @ts-ignore
                        cookies: params.cookies
                    };
                    break;

                case 'deleteCookie':
                    // @ts-ignore
                    if (params.name) {
// @ts-ignore
                        const cookies = await this.page.cookies();
                        // @ts-ignore
                        const cookieToDelete = cookies.find(c => c.name === params.name);
                        if (cookieToDelete) {
// @ts-ignore
                            await this.page.deleteCookie(cookieToDelete);
                        }
                    // @ts-ignore
                    } else if (params.cookies) {
// @ts-ignore
                        await this.page.deleteCookie(...params.cookies);
                    }
                    result = {
                        action: 'deleteCookie',
                        // @ts-ignore
                        name: params.name,
                        // @ts-ignore
                        cookies: params.cookies
                    };
                    break;

                case 'clearCache': {
// @ts-ignore
                    const client = await this.page.target().createCDPSession();
// @ts-ignore
                    await client.send('Network.clearBrowserCache');
                    result = { action: 'clearCache' };
                    break;
                }

                case 'clearCookies': {
// @ts-ignore
                    const cookies = await this.page.cookies();
// @ts-ignore
                    await this.page.deleteCookie(...cookies);
                    result = {
                        action: 'clearCookies',
                        deletedCount: cookies.length
                    };
                    break;
                }

                default:
// @ts-ignore
// @ts-ignore
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

            // 等待操作完成
// @ts-ignore
            if (params.waitAfterAction) {
// @ts-ignore
                await new Promise(resolve => setTimeout(resolve, params.waitAfterAction));
            }

            const endTime = new Date().toISOString();

            // 获取操作后的页面状态
// @ts-ignore
            const pageInfo = await this.page.evaluate(() => ({
// @ts-ignore
                title: document.title,
                url: window.location.href,
// @ts-ignore
                readyState: document.readyState
            }));

            logger.log(`Puppeteer操作 ${action} 执行完成`);

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: `Puppeteer操作 ${action} 执行成功`,
                data: {
                    action: action,
// @ts-ignore
                    result: result,
                    pageInfo: pageInfo,
                    timing: {
                        startTime: startTime,
                        endTime: endTime
                    }
                }
            };

        } catch (error: any) {
            console.error(`执行Puppeteer操作 ${action} 失败:`, error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `执行Puppeteer操作失败: ${(error as Error).message}`,
                action: action,
                params: params
            };
        }
    }

    /**
     * 获取页面元素信息
     */
    async getElementInfo(selector) {
// @ts-ignore
        if (!this.isOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开'
            };
        }

        try {
// @ts-ignore
            const elementInfo = await this.page.evaluate((sel) => {
// @ts-ignore
                const element = document.querySelector(sel);
                if (!element) {
// @ts-ignore
// @ts-ignore
                    return { exists: false };
                }

                const rect = element.getBoundingClientRect();
                const styles = window.getComputedStyle(element);

// @ts-ignore
// @ts-ignore
                return {
                    exists: true,
                    tagName: element.tagName,
                    id: element.id,
                    className: element.className,
                    textContent: element.textContent?.substring(0, 200),
                    innerHTML: element.innerHTML?.substring(0, 500),
                    attributes: Array.from(element.attributes).reduce((acc, attr) => {
// @ts-ignore
                        acc[attr.name] = attr.value;
                        return acc;
                    }, {}),
                    boundingBox: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        top: rect.top,
                        right: rect.right,
                        bottom: rect.bottom,
                        left: rect.left
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

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: '获取元素信息成功',
                data: elementInfo
            };

        } catch (error: any) {
            console.error('获取元素信息失败:', error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `获取元素信息失败: ${(error as Error).message}`
            };
        }
    }

    /**
     * 获取当前页面状态
     */
    async getPageStatus() {
// @ts-ignore
        if (!this.isOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开'
            };
        }

        try {
// @ts-ignore
            const pageInfo = await this.page.evaluate(() => ({
// @ts-ignore
                title: document.title,
                url: window.location.href,
// @ts-ignore
                readyState: document.readyState,
// @ts-ignore
                contentLength: document.documentElement.outerHTML.length,
// @ts-ignore
                textLength: document.body.textContent.length
            }));

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: '获取页面状态成功',
                data: pageInfo
            };

        } catch (error: any) {
            console.error('获取页面状态失败:', error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `获取页面状态失败: ${(error as Error).message}`
            };
        }
    }

    setupEventListeners() {
// @ts-ignore
        if (!this.page) return;

        // 控制台输出
// @ts-ignore
        this.page.on('console', msg => {
            logger.log('浏览器控制台:', msg.type(), msg.text());
        });

        // 页面错误
// @ts-ignore
        this.page.on('pageerror', error => {
            logger.log('页面错误:', error);
        });

        // 请求失败
// @ts-ignore
        this.page.on('requestfailed', request => {
            logger.log('请求失败:', request.url(), request.failure().errorText);
        });
    }

    /**
     * 获取浏览器状态
     */
    getBrowserStatus() {
// @ts-ignore
// @ts-ignore
        return {
// @ts-ignore
            isOpen: this.isOpen,
            timestamp: new Date().toISOString()
        };
    }
}

class ContentExtractor {
    constructor() {
        if (!(ContentExtractor as any).instance) {
// @ts-ignore
// @ts-ignore
            this.browser = new BrowserController();
// @ts-ignore
            this.isBrowserOpen = false;
            (ContentExtractor as any).instance = this;
        }
        return (ContentExtractor as any).instance;
    }

    /**
     * 主函数 - 处理所有操作
     */
    async main(params) {
        const { operation, ...operationParams } = params;

        try {
            switch (operation) {
                case 'open':
                    return await this.openBrowser(operationParams);

                case 'close':
// @ts-ignore
                    return await this.closeBrowser();

                case 'execute_js':
                    return await this.executeJavaScript(operationParams);

                case 'get_content':
                    return await this.getPageContent(operationParams);

                case 'puppeteer_action':
                    return await this.executePuppeteerAction(operationParams);

                case 'get_element_info':
                    return await this.getElementInfo(operationParams);

                default:
// @ts-ignore
// @ts-ignore
                    return {
                        success: false,
                        message: `不支持的操作: ${operation}`,
                        supported_operations: [
                            'open', 'close', 'execute_js', 'get_content',
                            'puppeteer_action', 'get_element_info'
                        ]
                    };
            }
        } catch (error: any) {
            console.error(`执行操作 ${operation} 时发生错误:`, error);
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `操作执行失败: ${(error as Error).message}`,
                operation: operation
            };
        }
    }

    /**
     * 操作：打开浏览器
     */
    async openBrowser(options: { width?: number; height?: number } = {} as any) {
// @ts-ignore
// @ts-ignore
// @ts-ignore
        await this.browser?.closeBrowser();
// @ts-ignore
// @ts-ignore
        const result = await this.browser.openBrowser(options);
// @ts-ignore
        if (result.success) {
// @ts-ignore
            this.isBrowserOpen = true;
        }
        return result;
    }

    /**
     * 操作：关闭浏览器
     */
    async closeBrowser() {
// @ts-ignore
// @ts-ignore
// @ts-ignore
        const result = await this.browser.closeBrowser();
// @ts-ignore
        if (result.success) {
// @ts-ignore
            this.isBrowserOpen = false;
        }
        return result;
    }

    /**
     * 操作：执行JavaScript代码
     */
    async executeJavaScript(params) {
        const { js, wait_after_execution = 1000 } = params;

        if (!js) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '执行JavaScript需要提供 js 参数'
            };
        }

// @ts-ignore
        if (!this.isBrowserOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

// @ts-ignore
// @ts-ignore
        const result = await this.browser.executeJavaScript(js, {
            waitAfterExecution: wait_after_execution
        });

        return result;
    }

    /**
     * 操作：执行Puppeteer原生操作
     */
    async executePuppeteerAction(params) {
        const {
            action,
            wait_after_action = 1000,
            ...actionParams
        } = params;

        if (!action) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '执行Puppeteer操作需要提供 action 参数'
            };
        }

// @ts-ignore
        if (!this.isBrowserOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

// @ts-ignore
// @ts-ignore
        const result = await this.browser.executePuppeteerAction(action, {
            ...actionParams,
            waitAfterAction: wait_after_action
        });

        return result;
    }

    /**
     * 操作：获取元素信息
     */
    async getElementInfo(params) {
        const { selector } = params;

        if (!selector) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '获取元素信息需要提供 selector 参数'
            };
        }

// @ts-ignore
        if (!this.isBrowserOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

// @ts-ignore
// @ts-ignore
        const result = await this.browser.getElementInfo(selector);
        return result;
    }

    /**
     * 操作：获取网页内容
     */
    async getPageContent(params) {
        const {
            action = 'extractText',
            url,
            max_length = 10240,
            regex_pattern,
            regex_flags = 'gi',
            remove_selectors,
            content_type = 'text',
            block_javascript = false
        } = params;

// @ts-ignore
        if (!this.isBrowserOpen) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

        // 如果需要跳转到新URL
        if (url) {
// @ts-ignore
// @ts-ignore
            const navResult = await this.browser.navigateToUrl(url, {
                waitAfterLoad: 2000,
                blockJavaScript: block_javascript
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
                        maxLength: max_length,
                        removeSelectors: remove_selectors
                    });
                    break;

                case 'extractText':
                    contentResult = await this.extractText({
                        maxLength: max_length,
                        removeSelectors: remove_selectors
                    });
                    break;

                case 'regexMatch':
                    if (!regex_pattern) {
// @ts-ignore
// @ts-ignore
                        return {
                            success: false,
                            message: '正则匹配需要提供 regex_pattern 参数'
                        };
                    }
                    contentResult = await this.regexMatch({
                        regexPattern: regex_pattern,
                        regexFlags: regex_flags,
                        maxLength: max_length,
                        removeSelectors: remove_selectors,
                        contentType: content_type
                    });
                    break;

                default:
// @ts-ignore
// @ts-ignore
                    return {
                        success: false,
                        message: `不支持的行为: ${action}`,
                        supported_actions: ['extractHTML', 'extractText', 'regexMatch']
                    };
            }

            // 获取页面状态信息
// @ts-ignore
// @ts-ignore
            const pageStatus = await this.browser.getPageStatus();

// @ts-ignore
// @ts-ignore
            return {
                success: true,
                message: `${action} 操作完成`,
                data: {
                    action: action,
                    page_info: pageStatus.success ? pageStatus.data : null,
                    content: contentResult,
                    block_javascript: block_javascript
                }
            };

        } catch (error: any) {
// @ts-ignore
// @ts-ignore
            return {
                success: false,
                message: `获取内容失败: ${(error as Error).message}`,
                action: action
            };
        }
    }

    /**
     * 行为：提取HTML
     */
    async extractHTML(options = {} as any) {
        const jsCode = `
            (function() {
// @ts-ignore
// @ts-ignore
                const removeSelectors = ${JSON.stringify(options.removeSelectors || [
            'script', 'style', 'noscript', 'iframe',
            '.ad', '.advertisement', '.ads'
        ])};
                
// @ts-ignore
                const clone = document.documentElement.cloneNode(true);
                
                removeSelectors.forEach(selector => {
                    const elements = clone.querySelectorAll(selector);
                    elements.forEach(element => element.remove());
                });
                
                const html = clone.outerHTML;
// @ts-ignore
// @ts-ignore
                const maxLength = ${options.maxLength || 10240};
                
// @ts-ignore
// @ts-ignore
                return {
                    content: html.substring(0, maxLength),
                    original_length: html.length,
                    truncated_length: Math.min(html.length, maxLength),
                    is_truncated: html.length > maxLength,
                    type: 'html'
                };
            })()
        `;

// @ts-ignore
// @ts-ignore
        const result = await this.browser.executeJavaScript(jsCode);

// @ts-ignore
        if (result.success) {
// @ts-ignore
// @ts-ignore
            return result.data.result;
        } else {
// @ts-ignore
            throw new Error(`提取HTML失败: ${result.message}`);
        }
    }

    /**
     * 行为：提取Text
     */
    async extractText(options = {} as any) {
        const jsCode = `
            (function() {
// @ts-ignore
// @ts-ignore
                const removeSelectors = ${JSON.stringify(options.removeSelectors || [
            'script', 'style', 'noscript', 'iframe',
            'nav', 'header', 'footer',
            '.ad', '.advertisement', '.ads',
            '.sidebar', '.menu', '.navigation'
        ])};
                
                // 移除干扰元素
// @ts-ignore
                const tempDocument = document.cloneNode(true);
                removeSelectors.forEach(selector => {
                    const elements = tempDocument.querySelectorAll(selector);
                    elements.forEach(element => element.remove());
                });
                
                // 尝试找到主要内容区域
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
                
                // 清理文本
                const text = mainContent.textContent
                    .replace(/\\\\s+/g, ' ')
                    .trim();
                
// @ts-ignore
// @ts-ignore
                const maxLength = ${options.maxLength || 10240};
                
// @ts-ignore
// @ts-ignore
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

// @ts-ignore
// @ts-ignore
        const result = await this.browser.executeJavaScript(jsCode);

// @ts-ignore
        if (result.success) {
// @ts-ignore
// @ts-ignore
            return result.data.result;
        } else {
// @ts-ignore
            throw new Error(`提取Text失败: ${result.message}`);
        }
    }

    /**
     * 行为：正则匹配 - 根据内容类型进行匹配
     */
    async regexMatch(options = {} as any) {
        // @ts-ignore
        const { contentType = 'text' } = options;

        let baseContent;

        // 根据内容类型获取基础内容
        if (contentType === 'html') {
            baseContent = await this.extractHTML(options);
        } else {
            baseContent = await this.extractText(options);
        }

        const jsCode = `
            (function() {
                const content = ${JSON.stringify(baseContent.content)};
// @ts-ignore
// @ts-ignore
                const pattern = ${JSON.stringify(options.regexPattern)};
// @ts-ignore
// @ts-ignore
                const flags = ${JSON.stringify(options.regexFlags || 'gi')};
                const contentType = ${JSON.stringify(contentType)};
                
                try {
                    const regex = new RegExp(pattern, flags);
                    const matches: any[] = [];
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
                        
                        // 限制匹配数量
                        if (matches.length >= 50) {
                            break;
                        }
                    }
                    
// @ts-ignore
// @ts-ignore
                    return {
                        pattern: pattern,
                        flags: flags,
                        content_type: contentType,
                        matches_found: matches.length,
                        matches: matches,
                        content_preview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
                        type: 'regex'
                    };
                    
                } catch (error: any) {
// @ts-ignore
// @ts-ignore
                    return {
                        error: error.toString(),
                        pattern: pattern,
                        flags: flags,
                        content_type: contentType
                    };
                }
            })()
        `;

// @ts-ignore
// @ts-ignore
        const result = await this.browser.executeJavaScript(jsCode);

// @ts-ignore
        if (result.success) {
// @ts-ignore
// @ts-ignore
            const regexResult = result.data.result;
            if (regexResult.error) {
                throw new Error(`正则表达式错误: ${regexResult.error}`);
            }

// @ts-ignore
// @ts-ignore
            return {
                ...regexResult,
                base_content: baseContent
            };
        } else {
// @ts-ignore
            throw new Error(`正则匹配失败: ${result.message}`);
        }
    }

    /**
     * 获取浏览器状态
     */
    async getBrowserStatus() {
// @ts-ignore
// @ts-ignore
        return this.browser.getBrowserStatus();
    }
}

(ContentExtractor as any).instance = null;

/**
 * 获取工具提示
 */
function getPrompt() {
// @ts-ignore
// @ts-ignore
    return {
    "name": "browser_client",
// @ts-ignore
    "description": "Control browser and extract content with various options, including Puppeteer native actions\nFeatures: - Real browser automation with Puppeteer\n- JavaScript execution support\n- Content extraction with cleaning\n- Regex pattern matching on both HTML and text\n- Full Puppeteer native actions support\n- Element information extraction\n- Automatic main content detection\n- Context preview for regex matches\n- Block JavaScript loading for faster loading and cleaner content\n\nResponse Format for Puppeteer Actions:\n{\n  \"success\": true,\n  \"message\": \"Puppeteer\u64cd\u4f5c click \u6267\u884c\u6210\u529f\",\n  \"data\": {\n    \"action\": \"click\",\n    \"result\": {\n      \"selector\": \"#submit-btn\",\n      \"action\": \"click\"\n    },\n    \"pageInfo\": {\n      \"title\": \"Page Title\",\n      \"url\": \"https://example.com\",\n      \"readyState\": \"complete\"\n    },\n    \"timing\": {\n      \"startTime\": \"2023-01-01T00:00:00.000Z\",\n      \"endTime\": \"2023-01-01T00:00:01.000Z\"\n    }\n  }\n}\nOperation Details: 1. Open Browser:\n{\n  \"tool\": \"browser_client\",\n  \"params\": {\n    \"operation\": \"open\",\n    \"width\": 1200,          // Optional, default 1200\n    \"height\": 800           // Optional, default 800\n  }\n}\n\n2. Close Browser:\n{\n  \"tool\": \"browser_client\", \n  \"params\": {\n    \"operation\": \"close\"\n  }\n}\n\n3. Execute JavaScript:\n{\n  \"tool\": \"browser_client\",\n  \"params\": {\n    \"operation\": \"execute_js\",\n    \"js\": \"document.title = 'New Title';\",  // Required\n    \"wait_after_execution\": 1000            // Optional, default 1000ms\n  }\n}\n\n4. Get Page Content:\n{\n  \"tool\": \"browser_client\",\n  \"params\": {\n    \"operation\": \"get_content\",\n    \"action\": \"extractText\",           // Required: 'extractHTML', 'extractText', 'regexMatch'\n    \"url\": \"https://example.com\",      // Optional: navigate to new URL first\n    \"max_length\": 10240,                // Optional: max content length\n    \"remove_selectors\": [              // Optional: elements to remove\n      \"script\", \"style\", \".ads\"\n    ],\n    \"block_javascript\": true           // Optional: block JavaScript loading, default false\n  }\n}\n\n5. Execute Puppeteer Native Actions:\n{\n  \"tool\": \"browser_client\",\n  \"params\": {\n    \"operation\": \"puppeteer_action\",\n    \"action\": \"click\",                 // Required: see supported actions below\n    \"selector\": \"#submit-btn\",         // Required for element actions\n    \"wait_after_action\": 1000          // Optional: wait after action in ms\n  }\n}\n\n6. Get Element Information:\n{\n  \"tool\": \"browser_client\",\n  \"params\": {\n    \"operation\": \"get_element_info\",\n    \"selector\": \"#my-element\"          // Required: CSS selector\n  }\n}\n\nSupported Puppeteer Actions:\n\n- Element Interactions:\n  \u2022 click: Click on element\n  \u2022 type: Type text into input\n  \u2022 focus: Focus on element\n  \u2022 hover: Hover over element\n  \u2022 select: Select options in dropdown\n\n- Navigation:\n  \u2022 waitForNavigation: Wait for navigation\n  \u2022 reload: Reload page\n  \u2022 goBack: Go back in history\n  \u2022 goForward: Go forward in history\n\n- Waiting:\n  \u2022 waitForSelector: Wait for element to appear\n  \u2022 waitForFunction: Wait for function to return true\n\n- Screenshot:\n  \u2022 screenshot: Take screenshot\n\n- Scrolling:\n  \u2022 scroll: Scroll page or element into view\n\n- Page Evaluation:\n  \u2022 evaluate: Execute function in page context\n\n- Browser Control:\n  \u2022 setViewport: Set viewport size\n  \u2022 setUserAgent: Set user agent\n  \u2022 setCookie: Set cookies\n  \u2022 deleteCookie: Delete cookies\n  \u2022 clearCache: Clear browser cache\n  \u2022 clearCookies: Clear all cookies\n\nContent Actions:\n\n- extractHTML: Extract cleaned HTML content\n- extractText: Extract cleaned text content  \n- regexMatch: Apply regex pattern to specified content type\n\nRegex Match Specific Parameters:\n{\n  \"tool\": \"browser_client\",\n  \"params\": {\n    \"operation\": \"get_content\",\n    \"action\": \"regexMatch\", \n    \"regex_pattern\": \"\\\\\\\\bexample\\\\\\\\b\",      // Required for regexMatch\n    \"content_type\": \"html\",                   // Optional: 'html' or 'text', default 'text'\n    \"regex_flags\": \"gi\",                      // Optional, default 'gi'\n    \"max_length\": 20480,\n    \"block_javascript\": true                  // Optional: block JavaScript loading\n  }\n}\n\nContent Types for Regex Match:\n- 'text': Apply regex to extracted text content (default)\n- 'html': Apply regex to extracted HTML content",
    "parameters": {
        "type": "object",
        "properties": {
            "operation": {
                "type": "string",
                "description": "(Required) Operation type - 'open', 'close', 'execute_js', 'get_content', 'puppeteer_action', 'get_element_info'"
            }
        },
        "required": [
            "operation"
        ]
    }
};
}

// 测试函数
if (require.main === module) {
    (async () => {
        try {
            logger.log('=== 测试内容提取器（支持Puppeteer原生操作）===\n');
            const extractor = new ContentExtractor();

            // 1. 打开浏览器
            logger.log('1. 打开浏览器...');
            let result = await extractor.main({
                operation: 'open'
            });
// @ts-ignore
            logger.log('打开结果:', result.success ? '成功' : '失败');

// @ts-ignore
            if (!result.success) {
                return;
            }

            // 2. 导航到测试页面
            logger.log('\n2. 导航到测试页面...');
            result = await extractor.main({
                operation: 'get_content',
                action: 'extractText',
                url: 'https://example.com',
                block_javascript: true
            });
// @ts-ignore
            logger.log('导航结果:', result.success ? '成功' : '失败');

            // 3. 测试Puppeteer操作 - 滚动
            logger.log('\n3. 测试Puppeteer滚动操作...');
            result = await extractor.main({
                operation: 'puppeteer_action',
                action: 'scroll',
                y: 500,
                wait_after_action: 1000
            });
// @ts-ignore
            logger.log('滚动操作:', result.success ? '成功' : '失败');

            // 4. 测试获取元素信息
            logger.log('\n4. 测试获取元素信息...');
            result = await extractor.main({
                operation: 'get_element_info',
                selector: 'h1'
            });
// @ts-ignore
            logger.log('元素信息:', result.success ? '成功' : '失败');
// @ts-ignore
            if (result.success) {
// @ts-ignore
// @ts-ignore
                logger.log('元素存在:', result.data.exists);
            }

            // 5. 测试截图
            logger.log('\n5. 测试截图操作...');
            result = await extractor.main({
                operation: 'puppeteer_action',
                action: 'screenshot',
                fullPage: false
            });
// @ts-ignore
            logger.log('截图操作:', result.success ? '成功' : '失败');
// @ts-ignore
            if (result.success) {
// @ts-ignore
// @ts-ignore
                logger.log('截图数据长度:', result.data.result.data.length);
            }

            // 6. 关闭浏览器
            logger.log('\n6. 关闭浏览器...');
            result = await extractor.main({
                operation: 'close'
            });
// @ts-ignore
            logger.log('关闭结果:', result.success ? '成功' : '失败');

        } catch (error: any) {
            console.error('测试错误:', error);
        }
    })();
}

const extractor = new ContentExtractor();


export const main = async (params: any) => {
    return await extractor.main(params);
};
export { getPrompt };
