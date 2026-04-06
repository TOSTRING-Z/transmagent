import * as puppeteer from 'puppeteer';
import { logger } from '../utils/logger';
import { WindowManager } from '../main/windows/WindowManager';
import { ToolCall } from '../core/ToolCall';

// --- 类型定义 ---
export interface ErrorSolutionParams {
    error_message: string;
    max_results?: number;
    toolCall: ToolCall;
}

export interface SolutionMetadata {
    rank: number;
    votes: number;
    answers: number;
    views: number;
    is_answered: boolean;
}

export interface FormattedSolution {
    site: string;
    title: string;
    url: string;
    type: string;
    source_type: string;
    metadata: SolutionMetadata;
}

export interface SearchResult {
    success: boolean;
    error?: string;
    error_type?: string[];
    search_strategy?: string;
    sources_searched?: string[];
    solutions_count?: number;
    solutions: FormattedSolution[];
}

export interface RawSolution {
    title: string;
    url: string;
    votes: number;
    answers: number;
    views: number;
    is_answered: boolean;
}

class ErrorSolutionFinder {
    private errorKeywords: Record<string, string[]>;

    constructor() {
        this.errorKeywords = {
            'R': ['R', 'rlang', 'tidyverse', 'ggplot', 'dplyr', 'shiny', 'bioconductor', 'rstudio'],
            'conda': ['conda', 'anaconda', 'miniconda', 'environment', 'package', 'install', 'CondaHTTPError'],
            'python': ['python', 'pip', 'ModuleNotFoundError', 'ImportError', 'SyntaxError', 'TypeError'],
            'dependency': ['dependency', 'dependencies', 'requirement', 'version', 'conflict', 'satisfies', 'compatible'],
            'installation': ['install', 'installation', 'setup', 'configure', 'build', 'compiling']
        };
    }

    // 检测验证页面
    async waitForVerificationComplete(page: puppeteer.Page): Promise<boolean> {
        logger.log('🔍 检测到验证页面，请手动完成验证...');
        logger.log('💡 提示: 完成验证后，页面会自动跳转到搜索结果');

        // 可选：通知前端
        if (WindowManager?.instance?.alertWindow) {
            WindowManager.instance.alertWindow.show("log", "Please manually complete the verification");
        }

        const startTime = Date.now();
        const timeout = 180000; // 3分钟超时

        let lastUrl = await page.url();
        let consecutiveStableChecks = 0;

        while (Date.now() - startTime < timeout) {
            try {
                const currentUrl = await page.url();
                logger.log(`当前URL: ${currentUrl}`);

                if (currentUrl !== lastUrl) {
                    logger.log('🔄 检测到页面跳转...');
                    lastUrl = currentUrl;
                    consecutiveStableChecks = 0;

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

                // 检查页面内容
                const pageState = await page.evaluate(() => {
                    const resultSelectors = [
                        '.s-post-summary',
                        '.question-summary',
                        '.js-search-result',
                        '[data-result-id]',
                        '#mainbar',
                        '.content'
                    ];

                    const hasResults = resultSelectors.some(selector => !!document.querySelector(selector));

                    const verificationSelectors = [
                        '#recaptcha',
                        '.challenge-form',
                        '[class*="captcha"]',
                        '[class*="challenge"]',
                        '[class*="verification"]'
                    ];

                    const stillVerifying = verificationSelectors.some(selector => !!document.querySelector(selector));

                    const title = document.title.toLowerCase();
                    const isSearchPage = title.includes('search') || title.includes('stack overflow');

                    return {
                        hasResults,
                        stillVerifying,
                        isSearchPage,
                        title: document.title,
                        bodyText: document.body.textContent ? document.body.textContent.substring(0, 200) : ''
                    };
                });

                logger.log('页面状态:', {
                    hasResults: pageState.hasResults,
                    stillVerifying: pageState.stillVerifying,
                    isSearchPage: pageState.isSearchPage,
                    title: pageState.title
                });

                if (pageState.hasResults && !pageState.stillVerifying && pageState.isSearchPage) {
                    logger.log('✅ 验证完成，检测到搜索结果');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    return true;
                }

                if (consecutiveStableChecks > 3 && !pageState.stillVerifying) {
                    logger.log('🔄 URL稳定，尝试检查是否验证完成...');
                    if (consecutiveStableChecks > 6) {
                        logger.log('🔄 尝试重新加载页面...');
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        consecutiveStableChecks = 0;
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
                logger.log('⏳ 等待验证完成...');

            } catch (error: any) {
                logger.log(`⚠️ 检查过程中出现错误: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        logger.log('⏰ 验证等待超时，尝试继续...');
        return false;
    }

    async crawlStackOverflow(searchQuery: string, maxResults = 5): Promise<RawSolution[]> {
        let browser: puppeteer.Browser | null = null;
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

            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            });

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            });

            const searchUrl = `https://stackoverflow.com/search?q=${encodeURIComponent(searchQuery)}`;
            logger.log(`🔍 正在搜索 Stack Overflow: ${searchQuery}`);
            logger.log(`🌐 搜索URL: ${searchUrl}`);

            page.on('console', msg => {
                if (msg.type() === 'error') logger.log('❌ 页面错误:', msg.text());
            });

            page.on('response', response => {
                if (response.status() >= 400) {
                    logger.log('⚠️ 响应错误:', String(response.status()), response.url());
                }
            });

            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

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

            logger.log('📊 开始提取搜索结果...');
            const results = await this.extractSearchResults(page, maxResults);

            logger.log(`✅ 从 Stack Overflow 找到 ${results.length} 个结果`);
            return results;

        } catch (error: any) {
            logger.error(`❌ Stack Overflow 爬取错误: ${error.message}`);
            // 【核心修复】：必须抛出错误，不要静默返回空数组
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    async extractSearchResults(page: puppeteer.Page, maxResults: number): Promise<RawSolution[]> {
        try {
            await new Promise(resolve => setTimeout(resolve, 5000));

            const results = await page.evaluate((maxAllowed: number) => {
                const solutions: RawSolution[] = [];
                const selectors = [
                    '.s-post-summary',
                    '.question-summary',
                    '.js-search-result',
                    '[data-result-id]',
                    '.search-result',
                    '.result'
                ];

                let questionElements: Element[] = [];
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        questionElements = Array.from(elements);
                        break;
                    }
                }

                questionElements.forEach((element) => {
                    if (solutions.length >= maxAllowed) return;

                    let title = '', url = '', votes = 0, answers = 0, views = 0;

                    const titleSelectors = [
                        '.s-post-summary--content-title a',
                        '.result-link a',
                        'a.question-hyperlink',
                        'h3 a',
                        '.summary h3 a',
                        '.title a'
                    ];

                    for (const selector of titleSelectors) {
                        const titleElement = element.querySelector(selector) as HTMLAnchorElement;
                        if (titleElement && titleElement.textContent && titleElement.textContent.trim()) {
                            title = titleElement.textContent.trim();
                            url = titleElement.href;
                            break;
                        }
                    }

                    if (!title || !url) return;

                    const statsSelectors = ['.s-post-summary--stats', '.stats', '.statscontainer'];
                    for (const statsSelector of statsSelectors) {
                        const statsElement = element.querySelector(statsSelector);
                        if (statsElement) {
                            const voteSelectors = ['.s-post-summary--stats-item__emphasized', '.vote-count-post', '.votes'];
                            for (const voteSelector of voteSelectors) {
                                const voteElement = statsElement.querySelector(voteSelector);
                                if (voteElement && voteElement.textContent) {
                                    votes = parseInt(voteElement.textContent.trim()) || 0;
                                    break;
                                }
                            }

                            const answerSelectors = ['.s-post-summary--stats-item.has-answers', '.answered', '.status'];
                            for (const answerSelector of answerSelectors) {
                                const answerElement = statsElement.querySelector(answerSelector);
                                if (answerElement && answerElement.textContent) {
                                    answers = parseInt(answerElement.textContent.trim()) || 0;
                                    break;
                                }
                            }

                            const viewSelectors = ['.s-post-summary--stats-item:last-child', '.views'];
                            for (const viewSelector of viewSelectors) {
                                const viewElement = statsElement.querySelector(viewSelector);
                                if (viewElement && viewElement.textContent) {
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

                return solutions;
            }, maxResults);

            return results;

        } catch (error: any) {
            logger.error(`❌ 提取搜索结果错误: ${error.message}`);
            return [];
        }
    }

    analyzeErrorType(errorMessage: string): string[] {
        if (!errorMessage || typeof errorMessage !== 'string') {
            return ['general'];
        }

        const errorTypes: string[] = [];
        const lowerError = errorMessage.toLowerCase();

        for (const [type, keywords] of Object.entries(this.errorKeywords)) {
            if (keywords.some(keyword => lowerError.includes(keyword.toLowerCase()))) {
                errorTypes.push(type);
            }
        }

        return errorTypes.length > 0 ? errorTypes : ['general'];
    }

    async getSolutionUrls(errorMessage: string, maxResults = 5): Promise<SearchResult> {
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

            const formattedSolutions: FormattedSolution[] = solutions.map((solution, index) => ({
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

export function main() {
    return async ({ error_message, max_results = 5, toolCall }: ErrorSolutionParams): Promise<SearchResult> => {
        try {
            if (!error_message) {
                return {
                    success: false,
                    error: 'error_message parameter is required',
                    solutions: []
                };
            }

            const finder = new ErrorSolutionFinder();
            return await finder.getSolutionUrls(error_message, max_results);
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                solutions: []
            };
        }
    }
}

export function getPrompt() {
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