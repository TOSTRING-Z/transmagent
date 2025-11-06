const puppeteer = require('puppeteer');

class BrowserController {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isOpen = false;
    }

    /**
     * 打开浏览器
     */
    async openBrowser(options = {}) {
        if (this.isOpen) {
            return { success: true, message: '浏览器已经打开' };
        }

        try {
            console.log('正在启动浏览器...');
            this.browser = await puppeteer.launch({
                headless: false,
                devtools: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--window-size=1200,800'
                ],
                defaultViewport: {
                    width: options.width || 1200,
                    height: options.height || 800
                }
            });

            this.page = await this.browser.newPage();

            // 设置浏览器环境
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            });

            // 设置事件监听
            this.setupEventListeners();

            this.isOpen = true;
            console.log('浏览器启动成功');

            return {
                success: true,
                message: '浏览器启动成功'
            };

        } catch (error) {
            console.error('启动浏览器失败:', error);
            return {
                success: false,
                message: `启动浏览器失败: ${error.message}`
            };
        }
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser() {
        if (!this.isOpen) {
            return { success: true, message: '浏览器已经关闭' };
        }

        try {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isOpen = false;

            console.log('浏览器关闭成功');
            return { success: true, message: '浏览器关闭成功' };

        } catch (error) {
            console.error('关闭浏览器失败:', error);
            return {
                success: false,
                message: `关闭浏览器失败: ${error.message}`
            };
        }
    }

    /**
     * 跳转到指定URL
     */
    async navigateToUrl(url, options = {}) {
        if (!this.isOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先调用 openBrowser'
            };
        }

        try {
            console.log(`正在导航到: ${url}`);

            // 设置拦截器来阻止 JavaScript 加载
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

            const navigationOptions = {
                waitUntil: options.waitUntil || 'networkidle2',
                timeout: options.timeout || 60000
            };

            await this.page.goto(url, navigationOptions);

            // 等待页面加载
            if (options.waitAfterLoad) {
                await new Promise(resolve => setTimeout(resolve, options.waitAfterLoad));
            }

            // 恢复请求拦截
            if (options.blockJavaScript) {
                await this.page.setRequestInterception(false);
            }

            const pageInfo = await this.page.evaluate(() => ({
                title: document.title,
                url: window.location.href,
                readyState: document.readyState
            }));

            console.log(`导航完成: ${pageInfo.title}`);

            return {
                success: true,
                message: '导航成功',
                data: pageInfo
            };

        } catch (error) {
            console.error(`导航到 ${url} 失败:`, error);
            // 确保在出错时也恢复请求拦截
            if (options.blockJavaScript) {
                await this.page.setRequestInterception(false).catch(() => { });
            }
            return {
                success: false,
                message: `导航失败: ${error.message}`,
                url: url
            };
        }
    }

    /**
     * 执行JavaScript代码
     */
    async executeJavaScript(jsCode, options = {}) {
        if (!this.isOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先调用 openBrowser'
            };
        }

        try {
            console.log('执行JavaScript代码...');

            const executionResult = await this.page.evaluate((code) => {
                const executionContext = {
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
                    executionContext.result = eval(code);
                } catch (error) {
                    executionContext.success = false;
                    executionContext.error = {
                        message: error.message,
                        stack: error.stack,
                        name: error.name
                    };
                }

                executionContext.endTime = new Date().toISOString();

                // 获取执行后的页面状态
                executionContext.pageInfoAfter = {
                    title: document.title,
                    url: window.location.href,
                    readyState: document.readyState
                };

                return executionContext;
            }, jsCode);

            // 等待执行后的效果
            if (options.waitAfterExecution) {
                await new Promise(resolve => setTimeout(resolve, options.waitAfterExecution));
            }

            console.log('JavaScript执行完成');

            return {
                success: true,
                message: 'JavaScript执行完成',
                data: executionResult
            };

        } catch (error) {
            console.error('执行JavaScript失败:', error);
            return {
                success: false,
                message: `执行JavaScript失败: ${error.message}`
            };
        }
    }

    /**
     * 执行Puppeteer原生操作
     */
    async executePuppeteerAction(action, params = {}) {
        if (!this.isOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先调用 openBrowser'
            };
        }

        try {
            console.log(`执行Puppeteer操作: ${action}`);

            let result = null;
            const startTime = new Date().toISOString();

            switch (action) {
                case 'click':
                    await this.page.click(params.selector, {
                        delay: params.delay || 0,
                        button: params.button || 'left',
                        clickCount: params.clickCount || 1
                    });
                    result = { selector: params.selector, action: 'click' };
                    break;

                case 'type':
                    await this.page.type(params.selector, params.text, {
                        delay: params.delay || 0
                    });
                    result = {
                        selector: params.selector,
                        text: params.text,
                        action: 'type'
                    };
                    break;

                case 'focus':
                    await this.page.focus(params.selector);
                    result = { selector: params.selector, action: 'focus' };
                    break;

                case 'hover':
                    await this.page.hover(params.selector);
                    result = { selector: params.selector, action: 'hover' };
                    break;

                case 'select': {
                    const selectResult = await this.page.select(params.selector, params.values);
                    result = {
                        selector: params.selector,
                        values: params.values,
                        selectedOptions: selectResult,
                        action: 'select'
                    };
                    break;
                }

                case 'waitForSelector':
                    await this.page.waitForSelector(params.selector, {
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

                case 'screenshot': {
                    const screenshot = await this.page.screenshot({
                        path: params.path,
                        type: params.type || 'png',
                        quality: params.quality,
                        fullPage: params.fullPage || false
                    });
                    result = {
                        action: 'screenshot',
                        type: params.type || 'png',
                        fullPage: params.fullPage || false,
                        data: screenshot.toString('base64')
                    };
                    break;
                }

                case 'scroll':
                    await this.page.evaluate((scrollParams) => {
                        if (scrollParams.selector) {
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
                        x: params.x,
                        y: params.y,
                        selector: params.selector
                    };
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

                case 'evaluate': {
                    const evaluateResult = await this.page.evaluate(params.function, ...(params.args || []));
                    result = {
                        action: 'evaluate',
                        result: evaluateResult
                    };
                    break;
                }

                case 'waitForFunction':
                    await this.page.waitForFunction(params.function, {
                        timeout: params.timeout || 30000,
                        polling: params.polling
                    }, ...(params.args || []));
                    result = { action: 'waitForFunction' };
                    break;

                case 'setViewport':
                    await this.page.setViewport(params.viewport);
                    result = {
                        action: 'setViewport',
                        viewport: params.viewport
                    };
                    break;

                case 'setUserAgent':
                    await this.page.setUserAgent(params.userAgent);
                    result = {
                        action: 'setUserAgent',
                        userAgent: params.userAgent
                    };
                    break;

                case 'setCookie':
                    await this.page.setCookie(...(params.cookies || []));
                    result = {
                        action: 'setCookie',
                        cookies: params.cookies
                    };
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
                    result = {
                        action: 'deleteCookie',
                        name: params.name,
                        cookies: params.cookies
                    };
                    break;

                case 'clearCache': {
                    const client = await this.page.target().createCDPSession();
                    await client.send('Network.clearBrowserCache');
                    result = { action: 'clearCache' };
                    break;
                }

                case 'clearCookies': {
                    const cookies = await this.page.cookies();
                    await this.page.deleteCookie(...cookies);
                    result = {
                        action: 'clearCookies',
                        deletedCount: cookies.length
                    };
                    break;
                }

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

            // 等待操作完成
            if (params.waitAfterAction) {
                await new Promise(resolve => setTimeout(resolve, params.waitAfterAction));
            }

            const endTime = new Date().toISOString();

            // 获取操作后的页面状态
            const pageInfo = await this.page.evaluate(() => ({
                title: document.title,
                url: window.location.href,
                readyState: document.readyState
            }));

            console.log(`Puppeteer操作 ${action} 执行完成`);

            return {
                success: true,
                message: `Puppeteer操作 ${action} 执行成功`,
                data: {
                    action: action,
                    result: result,
                    pageInfo: pageInfo,
                    timing: {
                        startTime: startTime,
                        endTime: endTime
                    }
                }
            };

        } catch (error) {
            console.error(`执行Puppeteer操作 ${action} 失败:`, error);
            return {
                success: false,
                message: `执行Puppeteer操作失败: ${error.message}`,
                action: action,
                params: params
            };
        }
    }

    /**
     * 获取页面元素信息
     */
    async getElementInfo(selector) {
        if (!this.isOpen) {
            return {
                success: false,
                message: '浏览器未打开'
            };
        }

        try {
            const elementInfo = await this.page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (!element) {
                    return { exists: false };
                }

                const rect = element.getBoundingClientRect();
                const styles = window.getComputedStyle(element);

                return {
                    exists: true,
                    tagName: element.tagName,
                    id: element.id,
                    className: element.className,
                    textContent: element.textContent?.substring(0, 200),
                    innerHTML: element.innerHTML?.substring(0, 500),
                    attributes: Array.from(element.attributes).reduce((acc, attr) => {
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

            return {
                success: true,
                message: '获取元素信息成功',
                data: elementInfo
            };

        } catch (error) {
            console.error('获取元素信息失败:', error);
            return {
                success: false,
                message: `获取元素信息失败: ${error.message}`
            };
        }
    }

    /**
     * 获取当前页面状态
     */
    async getPageStatus() {
        if (!this.isOpen) {
            return {
                success: false,
                message: '浏览器未打开'
            };
        }

        try {
            const pageInfo = await this.page.evaluate(() => ({
                title: document.title,
                url: window.location.href,
                readyState: document.readyState,
                contentLength: document.documentElement.outerHTML.length,
                textLength: document.body.textContent.length
            }));

            return {
                success: true,
                message: '获取页面状态成功',
                data: pageInfo
            };

        } catch (error) {
            console.error('获取页面状态失败:', error);
            return {
                success: false,
                message: `获取页面状态失败: ${error.message}`
            };
        }
    }

    setupEventListeners() {
        if (!this.page) return;

        // 控制台输出
        this.page.on('console', msg => {
            console.log('浏览器控制台:', msg.type(), msg.text());
        });

        // 页面错误
        this.page.on('pageerror', error => {
            console.log('页面错误:', error);
        });

        // 请求失败
        this.page.on('requestfailed', request => {
            console.log('请求失败:', request.url(), request.failure().errorText);
        });
    }

    /**
     * 获取浏览器状态
     */
    getBrowserStatus() {
        return {
            isOpen: this.isOpen,
            timestamp: new Date().toISOString()
        };
    }
}

class ContentExtractor {
    constructor() {
        if (!ContentExtractor.instance) {
            this.browser = new BrowserController();
            this.isBrowserOpen = false;
            ContentExtractor.instance = this;
        }
        return ContentExtractor.instance;
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
                    return {
                        success: false,
                        message: `不支持的操作: ${operation}`,
                        supported_operations: [
                            'open', 'close', 'execute_js', 'get_content',
                            'puppeteer_action', 'get_element_info'
                        ]
                    };
            }
        } catch (error) {
            console.error(`执行操作 ${operation} 时发生错误:`, error);
            return {
                success: false,
                message: `操作执行失败: ${error.message}`,
                operation: operation
            };
        }
    }

    /**
     * 操作：打开浏览器
     */
    async openBrowser(options = {}) {
        await this.browser?.closeBrowser();
        const result = await this.browser.openBrowser(options);
        if (result.success) {
            this.isBrowserOpen = true;
        }
        return result;
    }

    /**
     * 操作：关闭浏览器
     */
    async closeBrowser() {
        const result = await this.browser.closeBrowser();
        if (result.success) {
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
            return {
                success: false,
                message: '执行JavaScript需要提供 js 参数'
            };
        }

        if (!this.isBrowserOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

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
            return {
                success: false,
                message: '执行Puppeteer操作需要提供 action 参数'
            };
        }

        if (!this.isBrowserOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

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
            return {
                success: false,
                message: '获取元素信息需要提供 selector 参数'
            };
        }

        if (!this.isBrowserOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

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

        if (!this.isBrowserOpen) {
            return {
                success: false,
                message: '浏览器未打开，请先执行 open 操作'
            };
        }

        // 如果需要跳转到新URL
        if (url) {
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
                    return {
                        success: false,
                        message: `不支持的行为: ${action}`,
                        supported_actions: ['extractHTML', 'extractText', 'regexMatch']
                    };
            }

            // 获取页面状态信息
            const pageStatus = await this.browser.getPageStatus();

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

        } catch (error) {
            return {
                success: false,
                message: `获取内容失败: ${error.message}`,
                action: action
            };
        }
    }

    /**
     * 行为：提取HTML
     */
    async extractHTML(options = {}) {
        const jsCode = `
            (function() {
                const removeSelectors = ${JSON.stringify(options.removeSelectors || [
            'script', 'style', 'noscript', 'iframe',
            '.ad', '.advertisement', '.ads'
        ])};
                
                const clone = document.documentElement.cloneNode(true);
                
                removeSelectors.forEach(selector => {
                    const elements = clone.querySelectorAll(selector);
                    elements.forEach(element => element.remove());
                });
                
                const html = clone.outerHTML;
                const maxLength = ${options.maxLength || 10240};
                
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

    /**
     * 行为：提取Text
     */
    async extractText(options = {}) {
        const jsCode = `
            (function() {
                const removeSelectors = ${JSON.stringify(options.removeSelectors || [
            'script', 'style', 'noscript', 'iframe',
            'nav', 'header', 'footer',
            '.ad', '.advertisement', '.ads',
            '.sidebar', '.menu', '.navigation'
        ])};
                
                // 移除干扰元素
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
                
                const maxLength = ${options.maxLength || 10240};
                
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

    /**
     * 行为：正则匹配 - 根据内容类型进行匹配
     */
    async regexMatch(options = {}) {
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
                        
                        // 限制匹配数量
                        if (matches.length >= 50) {
                            break;
                        }
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
                    return {
                        error: error.toString(),
                        pattern: pattern,
                        flags: flags,
                        content_type: contentType
                    };
                }
            })()
        `;

        const result = await this.browser.executeJavaScript(jsCode);

        if (result.success) {
            const regexResult = result.data.result;
            if (regexResult.error) {
                throw new Error(`正则表达式错误: ${regexResult.error}`);
            }

            return {
                ...regexResult,
                base_content: baseContent
            };
        } else {
            throw new Error(`正则匹配失败: ${result.message}`);
        }
    }

    /**
     * 获取浏览器状态
     */
    async getBrowserStatus() {
        return this.browser.getBrowserStatus();
    }
}

ContentExtractor.instance = null;

/**
 * 获取工具提示
 */
function getPrompt() {
    return `## browser_client

Description: Control browser and extract content with various options, including Puppeteer native actions

Parameters:
- operation: (Required) Operation type - 'open', 'close', 'execute_js', 'get_content', 'puppeteer_action', 'get_element_info'

Operation Details:

1. Open Browser:
{
  "tool": "browser_client",
  "params": {
    "operation": "open",
    "width": 1200,          // Optional, default 1200
    "height": 800           // Optional, default 800
  }
}

2. Close Browser:
{
  "tool": "browser_client", 
  "params": {
    "operation": "close"
  }
}

3. Execute JavaScript:
{
  "tool": "browser_client",
  "params": {
    "operation": "execute_js",
    "js": "document.title = 'New Title';",  // Required
    "wait_after_execution": 1000            // Optional, default 1000ms
  }
}

4. Get Page Content:
{
  "tool": "browser_client",
  "params": {
    "operation": "get_content",
    "action": "extractText",           // Required: 'extractHTML', 'extractText', 'regexMatch'
    "url": "https://example.com",      // Optional: navigate to new URL first
    "max_length": 10240,                // Optional: max content length
    "remove_selectors": [              // Optional: elements to remove
      "script", "style", ".ads"
    ],
    "block_javascript": true           // Optional: block JavaScript loading, default false
  }
}

5. Execute Puppeteer Native Actions:
{
  "tool": "browser_client",
  "params": {
    "operation": "puppeteer_action",
    "action": "click",                 // Required: see supported actions below
    "selector": "#submit-btn",         // Required for element actions
    "wait_after_action": 1000          // Optional: wait after action in ms
  }
}

6. Get Element Information:
{
  "tool": "browser_client",
  "params": {
    "operation": "get_element_info",
    "selector": "#my-element"          // Required: CSS selector
  }
}

Supported Puppeteer Actions:

- Element Interactions:
  • click: Click on element
  • type: Type text into input
  • focus: Focus on element
  • hover: Hover over element
  • select: Select options in dropdown

- Navigation:
  • waitForNavigation: Wait for navigation
  • reload: Reload page
  • goBack: Go back in history
  • goForward: Go forward in history

- Waiting:
  • waitForSelector: Wait for element to appear
  • waitForFunction: Wait for function to return true

- Screenshot:
  • screenshot: Take screenshot

- Scrolling:
  • scroll: Scroll page or element into view

- Page Evaluation:
  • evaluate: Execute function in page context

- Browser Control:
  • setViewport: Set viewport size
  • setUserAgent: Set user agent
  • setCookie: Set cookies
  • deleteCookie: Delete cookies
  • clearCache: Clear browser cache
  • clearCookies: Clear all cookies

Content Actions:

- extractHTML: Extract cleaned HTML content
- extractText: Extract cleaned text content  
- regexMatch: Apply regex pattern to specified content type

Regex Match Specific Parameters:
{
  "tool": "browser_client",
  "params": {
    "operation": "get_content",
    "action": "regexMatch", 
    "regex_pattern": "\\\\bexample\\\\b",      // Required for regexMatch
    "content_type": "html",                   // Optional: 'html' or 'text', default 'text'
    "regex_flags": "gi",                      // Optional, default 'gi'
    "max_length": 20480,
    "block_javascript": true                  // Optional: block JavaScript loading
  }
}

Content Types for Regex Match:
- 'text': Apply regex to extracted text content (default)
- 'html': Apply regex to extracted HTML content

Features:
- Real browser automation with Puppeteer
- JavaScript execution support
- Content extraction with cleaning
- Regex pattern matching on both HTML and text
- Full Puppeteer native actions support
- Element information extraction
- Automatic main content detection
- Context preview for regex matches
- Block JavaScript loading for faster loading and cleaner content

Response Format for Puppeteer Actions:
{
  "success": true,
  "message": "Puppeteer操作 click 执行成功",
  "data": {
    "action": "click",
    "result": {
      "selector": "#submit-btn",
      "action": "click"
    },
    "pageInfo": {
      "title": "Page Title",
      "url": "https://example.com",
      "readyState": "complete"
    },
    "timing": {
      "startTime": "2023-01-01T00:00:00.000Z",
      "endTime": "2023-01-01T00:00:01.000Z"
    }
  }
}`;
}

// 测试函数
if (require.main === module) {
    (async () => {
        try {
            console.log('=== 测试内容提取器（支持Puppeteer原生操作）===\n');
            const extractor = new ContentExtractor();

            // 1. 打开浏览器
            console.log('1. 打开浏览器...');
            let result = await extractor.main({
                operation: 'open'
            });
            console.log('打开结果:', result.success ? '成功' : '失败');

            if (!result.success) {
                return;
            }

            // 2. 导航到测试页面
            console.log('\n2. 导航到测试页面...');
            result = await extractor.main({
                operation: 'get_content',
                action: 'extractText',
                url: 'https://example.com',
                block_javascript: true
            });
            console.log('导航结果:', result.success ? '成功' : '失败');

            // 3. 测试Puppeteer操作 - 滚动
            console.log('\n3. 测试Puppeteer滚动操作...');
            result = await extractor.main({
                operation: 'puppeteer_action',
                action: 'scroll',
                y: 500,
                wait_after_action: 1000
            });
            console.log('滚动操作:', result.success ? '成功' : '失败');

            // 4. 测试获取元素信息
            console.log('\n4. 测试获取元素信息...');
            result = await extractor.main({
                operation: 'get_element_info',
                selector: 'h1'
            });
            console.log('元素信息:', result.success ? '成功' : '失败');
            if (result.success) {
                console.log('元素存在:', result.data.exists);
            }

            // 5. 测试截图
            console.log('\n5. 测试截图操作...');
            result = await extractor.main({
                operation: 'puppeteer_action',
                action: 'screenshot',
                fullPage: false
            });
            console.log('截图操作:', result.success ? '成功' : '失败');
            if (result.success) {
                console.log('截图数据长度:', result.data.result.data.length);
            }

            // 6. 关闭浏览器
            console.log('\n6. 关闭浏览器...');
            result = await extractor.main({
                operation: 'close'
            });
            console.log('关闭结果:', result.success ? '成功' : '失败');

        } catch (error) {
            console.error('测试错误:', error);
        }
    })();
}

const extractor = new ContentExtractor();

module.exports = {
    main: async (params) => {
        return await extractor.main(params);
    },
    getPrompt
};