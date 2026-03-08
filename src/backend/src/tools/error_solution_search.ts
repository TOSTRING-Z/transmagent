import { logger } from '../utils/logger';
const puppeteer = require('puppeteer');
const { WindowManager } = require("../main/windows/WindowManager");

class ErrorSolutionFinder {
    constructor() {
        // @ts-ignore
        this.errorKeywords = {
            'R': ['R', 'rlang', 'tidyverse', 'ggplot', 'dplyr', 'shiny', 'bioconductor', 'rstudio'],
            'conda': ['conda', 'anaconda', 'miniconda', 'environment', 'package', 'install', 'CondaHTTPError'],
            'python': ['python', 'pip', 'ModuleNotFoundError', 'ImportError', 'SyntaxError', 'TypeError'],
            'dependency': ['dependency', 'dependencies', 'requirement', 'version', 'conflict', 'satisfies', 'compatible'],
            'installation': ['install', 'installation', 'setup', 'configure', 'build', 'compiling']
        };
    }

    // 改进的验证完成检测方法
    async waitForVerificationComplete(page) {
        logger.log('🔍 检测到验证页面，请手动完成验证...');
        logger.log('💡 提示: 完成验证后，页面会自动跳转到搜索结果');
        WindowManager.instance?.alertWindow.show("log", "Please manually complete the verification");

        const startTime = Date.now();
        const timeout = 180000; // 3分钟超时

        let lastUrl = await page.url();
        let consecutiveStableChecks = 0;

        while (Date.now() - startTime < timeout) {
            try {
                const currentUrl = await page.url();
                logger.log(`当前URL: ${currentUrl}`);

                // URL 发生变化说明页面在跳转
                if (currentUrl !== lastUrl) {
                    logger.log('🔄 检测到页面跳转...');
                    lastUrl = currentUrl;
                    consecutiveStableChecks = 0;

                    // 检查是否跳转到搜索结果页面
                    if (currentUrl.includes('/search') &&
                        !currentUrl.includes('nocaptcha') &&
                        !currentUrl.includes('challenge')) {
                        logger.log('✅ 已跳转到搜索结果页面');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        return true;
                    }
                } else {
                    consecutiveStableChecks++;
                }

                // 检查页面内容是否包含搜索结果
                const pageState = await page.evaluate(() => {
                    // 检查搜索结果元素
                    const resultSelectors = [
                        '.s-post-summary',
                        '.question-summary',
                        '.js-search-result',
                        '[data-result-id]',
                        '#mainbar', // 主内容区域
                        '.content'  // 内容区域
                    ];

                    const hasResults = resultSelectors.some(selector =>
                        document.querySelector(selector)
                    );

                    // 检查是否还在验证页面
                    const verificationSelectors = [
                        '#recaptcha',
                        '.challenge-form',
                        '[class*="captcha"]',
                        '[class*="challenge"]',
                        '[class*="verification"]'
                    ];

                    const stillVerifying = verificationSelectors.some(selector =>
                        document.querySelector(selector)
                    );

                    // 检查页面标题
                    const title = document.title.toLowerCase();
                    const isSearchPage = title.includes('search') || title.includes('stack overflow');

                    return {
                        hasResults,
                        stillVerifying,
                        isSearchPage,
                        title: document.title,
                        // @ts-ignore
                        bodyText: document.body.textContent.substring(0, 200)
                    };
                });

                logger.log('页面状态:', {
                    hasResults: pageState.hasResults,
                    stillVerifying: pageState.stillVerifying,
                    isSearchPage: pageState.isSearchPage,
                    title: pageState.title
                });

                // 如果检测到搜索结果且不在验证页面
                if (pageState.hasResults && !pageState.stillVerifying && pageState.isSearchPage) {
                    logger.log('✅ 验证完成，检测到搜索结果');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    return true;
                }

                // 如果URL稳定且不在验证页面，可能是验证完成但需要手动触发
                if (consecutiveStableChecks > 3 && !pageState.stillVerifying) {
                    logger.log('🔄 URL稳定，尝试检查是否验证完成...');

                    // 尝试重新加载页面
                    if (consecutiveStableChecks > 6) {
                        logger.log('🔄 尝试重新加载页面...');
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        consecutiveStableChecks = 0;
                    }
                }

                // 等待2秒后再次检查
                await new Promise(resolve => setTimeout(resolve, 2000));
                logger.log('⏳ 等待验证完成...');

            } catch (error: any) {
                logger.log('⚠️ 检查过程中出现错误:', error.message);
                // 继续等待
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        logger.log('⏰ 验证等待超时，尝试继续...');
        return false;
    }

    // 使用浏览器爬取 Stack Overflow
    async crawlStackOverflow(searchQuery, maxResults = 5) {
        let browser: any = null;
        try {
            browser = await puppeteer.launch({
                headless: false,
                devtools: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--window-size=1400,1000',
                    '--disable-blink-features=AutomationControlled'
                ],
                defaultViewport: {
                    width: 1400,
                    height: 1000
                }
            });

            const page = await browser.newPage();

            // 隐藏自动化特征
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                });
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en'],
                });
            });

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 设置额外的HTTP头
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            });

            const searchUrl = `https://stackoverflow.com/search?q=${encodeURIComponent(searchQuery)}`;
            logger.log(`🔍 正在搜索 Stack Overflow: ${searchQuery}`);
            logger.log(`🌐 搜索URL: ${searchUrl}`);

            // 设置页面错误处理
            page.on('console', msg => {
                if (msg.type() === 'error') {
                    logger.log('❌ 页面错误:', msg.text());
                }
            });

            page.on('response', response => {
                if (response.status() >= 400) {
                    logger.log('⚠️ 响应错误:', response.status(), response.url());
                }
            });

            await page.goto(searchUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // 检查初始页面状态
            const initialUrl = await page.url();
            logger.log(`📍 初始页面URL: ${initialUrl}`);

            const needsVerification = initialUrl.includes('nocaptcha') ||
                initialUrl.includes('challenge') ||
                initialUrl.includes('verification') ||
                initialUrl.includes('authenticate');

            if (needsVerification) {
                logger.log('🛡️ 需要验证，等待手动完成...');
                const verificationSuccess = await this.waitForVerificationComplete(page);

                if (!verificationSuccess) {
                    logger.log('⚠️ 验证可能未完成，尝试继续...');
                }
            }

            // 最终提取结果
            logger.log('📊 开始提取搜索结果...');
            const results = await this.extractSearchResults(page, maxResults);

            logger.log(`✅ 从 Stack Overflow 找到 ${results.length} 个结果`);
            return results;

        } catch (error: any) {
            console.error('❌ Stack Overflow 爬取错误:', error.message);
            return [];
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    // 提取搜索结果
    async extractSearchResults(page, maxResults) {
        try {
            // 确保页面完全加载
            await new Promise(resolve => setTimeout(resolve, 5000));

            const results = await page.evaluate((maxResults) => {
                logger.log('🔍 在页面中搜索结果元素...');

                const solutions: any[] = [];

                // 多种选择器尝试
                const selectors = [
                    '.s-post-summary',
                    '.question-summary',
                    '.js-search-result',
                    '[data-result-id]',
                    '.search-result',
                    '.result'
                ];

                let questionElements: any[] = [];
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        logger.log(`✅ 使用选择器 "${selector}" 找到 ${elements.length} 个结果`);
                        // @ts-ignore
                        questionElements = elements;
                        break;
                    }
                }

                logger.log(`📋 总共找到 ${questionElements.length} 个搜索结果元素`);

                questionElements.forEach((element,) => {
                    if (solutions.length >= maxResults) return;

                    let title = '', url = '', votes = 0, answers = 0, views = 0;

                    // 提取标题和链接
                    const titleSelectors = [
                        '.s-post-summary--content-title a',
                        '.result-link a',
                        'a.question-hyperlink',
                        'h3 a',
                        '.summary h3 a',
                        '.title a'
                    ];

                    for (const selector of titleSelectors) {
                        const titleElement = element.querySelector(selector);
                        if (titleElement && titleElement.textContent && titleElement.textContent.trim()) {
                            title = titleElement.textContent.trim();
                            url = titleElement.href;
                            logger.log(`📖 找到标题: ${title.substring(0, 50)}...`);
                            break;
                        }
                    }

                    if (!title || !url) {
                        logger.log('❌ 未找到有效的标题或URL');
                        return;
                    }

                    // 提取统计数据
                    const statsSelectors = ['.s-post-summary--stats', '.stats', '.statscontainer'];
                    for (const statsSelector of statsSelectors) {
                        const statsElement = element.querySelector(statsSelector);
                        if (statsElement) {
                            // 投票数
                            const voteSelectors = ['.s-post-summary--stats-item__emphasized', '.vote-count-post', '.votes'];
                            for (const voteSelector of voteSelectors) {
                                const voteElement = statsElement.querySelector(voteSelector);
                                if (voteElement) {
                                    const voteText = voteElement.textContent.trim();
                                    votes = parseInt(voteText) || 0;
                                    break;
                                }
                            }

                            // 答案数
                            const answerSelectors = ['.s-post-summary--stats-item.has-answers', '.answered', '.status'];
                            for (const answerSelector of answerSelectors) {
                                const answerElement = statsElement.querySelector(answerSelector);
                                if (answerElement) {
                                    const answerText = answerElement.textContent.trim();
                                    answers = parseInt(answerText) || 0;
                                    break;
                                }
                            }

                            // 浏览数
                            const viewSelectors = ['.s-post-summary--stats-item:last-child', '.views'];
                            for (const viewSelector of viewSelectors) {
                                const viewElement = statsElement.querySelector(viewSelector);
                                if (viewElement) {
                                    const viewText = viewElement.textContent.trim();
                                    if (viewText.includes('k')) {
                                        views = parseFloat(viewText) * 1000;
                                    } else {
                                        views = parseInt(viewText) || 0;
                                    }
                                    break;
                                }
                            }
                            break;
                        }
                    }

                    solutions.push({
                        title: title,
                        url: url.startsWith('http') ? url : `https://stackoverflow.com${url}`,
                        votes: votes,
                        answers: answers,
                        views: views,
                        is_answered: answers > 0
                    });
                });

                logger.log(`🎉 最终提取到 ${solutions.length} 个有效结果`);
                return solutions;

            }, maxResults);

            return results;

        } catch (error: any) {
            console.error('❌ 提取搜索结果错误:', error.message);
            return [];
        }
    }

    analyzeErrorType(errorMessage) {
        if (!errorMessage || typeof errorMessage !== 'string') {
            return ['general'];
        }

        const errorTypes: any[] = [];
        const lowerError = errorMessage.toLowerCase();

        // @ts-ignore
        for (const [type, keywords] of Object.entries(this.errorKeywords)) {
            // @ts-ignore
            if (keywords.some(keyword => lowerError.includes(keyword.toLowerCase()))) {
                errorTypes.push(type);
            }
        }

        return errorTypes.length > 0 ? errorTypes : ['general'];
    }

    async getSolutionUrls(errorMessage, maxResults = 5) {
        try {
            if (!errorMessage || typeof errorMessage !== 'string') {
                return {
                    success: false,
                    error: 'error_message parameter is required and must be a string',
                    solutions: []
                };
            }

            logger.log(`🚀 开始搜索错误解决方案: "${errorMessage}"`);

            const solutions = await this.crawlStackOverflow(errorMessage, maxResults);

            // 格式化结果
            const formattedSolutions = solutions.map((solution, index) => ({
                site: 'Stack Overflow',
                title: solution.title,
                url: solution.url,
                type: 'specific_solution',
                source_type: 'browser_crawl',
                metadata: {
                    rank: index + 1,
                    votes: solution.votes,
                    answers: solution.answers,
                    views: solution.views,
                    is_answered: solution.is_answered
                }
            }));

            return {
                success: true,
                error_type: this.analyzeErrorType(errorMessage),
                search_strategy: 'stackoverflow_only',
                sources_searched: ['stackoverflow'],
                solutions_count: formattedSolutions.length,
                solutions: formattedSolutions
            };

        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                solutions: []
            };
        }
    }
}

function main({ error_message, max_results = 5 }) {
    try {
        if (!error_message) {
            return {
                success: false,
                error: 'error_message parameter is required',
                solutions: []
            };
        }

        const finder = new ErrorSolutionFinder();
        return finder.getSolutionUrls(error_message, max_results);
    } catch (error: any) {
        return {
            success: false,
            error: error.message,
            solutions: []
        };
    }
}

function getPrompt() {
    return {
    "name": "error_solution_search",
    "description": "Find programming error solutions from Stack Overflow using browser automation\nKey Features: \u2714 Uses browser automation to crawl Stack Overflow solutions  \n\u2714 Automatically handles verification challenges  \n\u2714 Analyzes error type automatically  \n\u2714 Returns actual solution pages with metadata\nFeatures: \u2714 Uses browser automation to crawl Stack Overflow solutions  \n\u2714 Automatically handles verification challenges  \n\u2714 Analyzes error type automatically  \n\u2714 Returns actual solution pages with metadata",
    "parameters": {
        "type": "object",
        "properties": {
            "error_message": {
                "type": "string",
                "description": "The error message to analyze (required)"
            },
            "max_results": {
                "type": "number",
                "description": "Maximum number of solution URLs to return (optional, default: 5)"
            }
        },
        "required": [
            "error_message"
        ]
    }
};
}

// 测试函数
if (require.main === module) {
    (async () => {
        try {
            const exampleErrors = [
                "Error: package 'dplyr' is not available for R version 4.2.1",
            ];

            for (const error of exampleErrors) {
                logger.log('='.repeat(60));
                logger.log(`处理错误: ${error}`);
                logger.log('='.repeat(60));

                const solutions = await main({
                    error_message: error,
                    max_results: 3
                });
                logger.log(JSON.stringify(solutions, null, 2));

                // 在每个错误之间等待一下
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        } catch (error: any) {
            console.error('调试错误:', error);
        }
    })();
}

export {
    main,
    getPrompt
};