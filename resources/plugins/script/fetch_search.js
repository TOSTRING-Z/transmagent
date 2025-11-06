const puppeteer = require('puppeteer');
const { WindowManager } = require("../modules/WindowManager");

/**
 * 统一搜索函数
 */
async function main({ context, num_results = 5, engine = "bing" }) {
    console.log('📊 开始提取搜索结果...');
    if (engine === 'baidu') {
        return await baiduSearch({ context, num_results });
    } else if (engine === 'bing') {
        return await bingSearch({ context, num_results });
    } else if (engine === 'google') {
        return await googleSearch({ context, num_results });
    } else {
        throw new Error(`不支持的搜索引擎: ${engine}，请选择 'baidu', 'bing' 或 'google'`);
    }
}

/**
 * 检查并处理验证页面 - 增强版本
 */
async function checkAndHandleVerification(page) {
    const initialUrl = await page.url();
    console.log(`📍 初始页面URL: ${initialUrl}`);

    // 扩展验证页面检测条件
    const needsVerification = await page.evaluate(() => {
        const url = window.location.href.toLowerCase();
        const verificationIndicators = [
            // URL 关键词
            url.includes('nocaptcha') || url.includes('challenge') ||
            url.includes('verification') || url.includes('authenticate') ||
            url.includes('captcha') || url.includes('verify') ||
            url.includes('security') || url.includes('botcheck') ||
            url.includes('gateway') || url.includes('protected'),
            
            // 页面内容关键词
            document.title.toLowerCase().includes('captcha') ||
            document.title.toLowerCase().includes('verification') ||
            document.title.toLowerCase().includes('security') ||
            document.title.toLowerCase().includes('challenge'),
            
            // 验证元素检测
            document.querySelector('#recaptcha, .g-recaptcha, .recaptcha, [class*="captcha"], [class*="challenge"], [class*="verification"], iframe[src*="recaptcha"], iframe[src*="challenge"]') !== null,
            
            // 验证文本检测
            document.body.innerText.toLowerCase().includes('are you a robot') ||
            document.body.innerText.toLowerCase().includes('i\'m not a robot') ||
            document.body.innerText.toLowerCase().includes('please verify') ||
            document.body.innerText.toLowerCase().includes('security check') ||
            document.body.innerText.toLowerCase().includes('complete the challenge')
        ];
        
        return verificationIndicators.some(indicator => indicator === true);
    });

    if (needsVerification) {
        console.log('🛡️ 检测到验证页面，开始处理验证流程...');
        
        // 分析验证类型
        const verificationType = await analyzeVerificationType(page);
        console.log(`🔍 验证类型: ${verificationType}`);
        
        // 根据验证类型采取不同策略
        const verificationSuccess = await handleVerificationByType(page, verificationType);
        
        if (verificationSuccess) {
            console.log('✅ 验证处理成功');
            return true;
        } else {
            console.log('⚠️ 验证处理失败，尝试备用方案...');
            return await fallbackVerificationStrategies(page);
        }
    }
    
    return false;
}

/**
 * 分析验证类型
 */
async function analyzeVerificationType(page) {
    return await page.evaluate(() => {
        // reCAPTCHA 检测
        if (document.querySelector('.g-recaptcha, #recaptcha, [class*="recaptcha"]')) {
            return 'recaptcha';
        }
        
        // hCaptcha 检测
        if (document.querySelector('.h-captcha, [class*="hcaptcha"]')) {
            return 'hcaptcha';
        }
        
        // Cloudflare Challenge 检测
        if (document.querySelector('#challenge-form, .challenge-form, #cf-content')) {
            return 'cloudflare';
        }
        
        // 图片验证码检测
        if (document.querySelector('img[src*="captcha"], img[src*="verify"], [class*="captcha-image"]')) {
            return 'image_captcha';
        }
        
        // 滑动验证检测
        if (document.querySelector('.slider, .slide-to-unlock, [class*="slider"]')) {
            return 'slide_verification';
        }
        
        // 点击验证检测
        if (document.querySelector('.verify-button, [class*="verify-btn"], [onclick*="verify"]')) {
            return 'click_verification';
        }
        
        // 文本验证检测
        if (document.querySelector('input[type="text"][placeholder*="captcha"], input[placeholder*="verify"]')) {
            return 'text_captcha';
        }
        
        // 旋转验证检测
        if (document.querySelector('.rotate, .puzzle, [class*="puzzle"]')) {
            return 'puzzle_verification';
        }
        
        return 'unknown';
    });
}

/**
 * 根据验证类型处理验证
 */
async function handleVerificationByType(page, verificationType) {
    console.log(`🔄 使用策略处理 ${verificationType} 验证...`);
    
    const strategies = {
        recaptcha: async () => {
            // reCAPTCHA 处理策略
            console.log('🎯 检测到 reCAPTCHA，等待手动处理...');
            
            // 尝试自动点击 "I'm not a robot" 复选框
            try {
                const iframe = await page.$('iframe[src*="recaptcha"]');
                if (iframe) {
                    const checkbox = await iframe.$('#recaptcha-anchor');
                    if (checkbox) {
                        await checkbox.click();
                        console.log('✅ 已点击 reCAPTCHA 复选框');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            } catch {
                console.log('⚠️ 无法自动点击 reCAPTCHA 复选框');
            }
            
            return await waitForVerificationComplete(page);
        },
        
        cloudflare: async () => {
            // Cloudflare 挑战处理
            console.log('🎯 检测到 Cloudflare 挑战...');
            
            // 等待 Cloudflare 挑战自动完成
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // 检查是否还有挑战页面
            const stillChallenged = await page.evaluate(() => {
                return document.querySelector('#challenge-form, .challenge-form') !== null;
            });
            
            if (!stillChallenged) {
                console.log('✅ Cloudflare 挑战可能已完成');
                return true;
            }
            
            return await waitForVerificationComplete(page);
        },
        
        image_captcha: async () => {
            // 图片验证码处理
            console.log('🎯 检测到图片验证码，需要人工干预...');
            return await waitForVerificationComplete(page);
        },
        
        click_verification: async () => {
            // 点击验证处理
            console.log('🎯 检测到点击验证，尝试自动处理...');
            
            const clickSuccess = await page.evaluate(() => {
                const buttons = [
                    ...document.querySelectorAll('button'),
                    ...document.querySelectorAll('input[type="button"]'),
                    ...document.querySelectorAll('a')
                ];
                
                const verifyButtons = buttons.filter(btn => {
                    const text = btn.textContent.toLowerCase();
                    return text.includes('verify') || text.includes('confirm') || 
                           text.includes('continue') || text.includes('i\'m human') ||
                           text.includes('not robot');
                });
                
                if (verifyButtons.length > 0) {
                    verifyButtons[0].click();
                    return true;
                }
                return false;
            });
            
            if (clickSuccess) {
                console.log('✅ 已尝试点击验证按钮');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            return await waitForVerificationComplete(page);
        },
        
        text_captcha: async () => {
            // 文本验证码处理
            console.log('🎯 检测到文本验证码，需要人工输入...');
            
            // 显示验证码文本提示
            const captchaText = await page.evaluate(() => {
                const elements = document.querySelectorAll('p, span, div, label');
                for (let el of elements) {
                    const text = el.textContent.toLowerCase();
                    if (text.includes('enter') && text.includes('captcha') || 
                        text.includes('type') && text.includes('text') ||
                        text.includes('verification') && text.includes('code')) {
                        return el.textContent;
                    }
                }
                return '请查看页面上的验证码提示';
            });
            
            console.log(`📝 验证码提示: ${captchaText}`);
            
            return await waitForVerificationComplete(page);
        },
        
        unknown: async () => {
            // 未知验证类型
            console.log('🎯 未知验证类型，使用通用处理策略...');
            return await waitForVerificationComplete(page);
        }
    };
    
    const strategy = strategies[verificationType] || strategies.unknown;
    return await strategy();
}

/**
 * 备用验证策略
 */
async function fallbackVerificationStrategies(page) {
    console.log('🔄 启动备用验证策略...');
    
    const strategies = [
        // 策略1: 刷新页面
        async () => {
            console.log('🔄 尝试刷新页面...');
            await page.reload({ waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const currentUrl = await page.url();
            const stillVerifying = currentUrl.includes('captcha') || currentUrl.includes('challenge');
            return !stillVerifying;
        },
        
        // 策略2: 返回上一页再前进
        async () => {
            console.log('🔄 尝试返回再前进...');
            await page.goBack();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.goForward();
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            return await checkVerificationStatus(page);
        },
        
        // 策略3: 修改 User-Agent
        async () => {
            console.log('🔄 尝试修改 User-Agent...');
            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ];
            
            const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
            await page.setUserAgent(randomUA);
            await page.reload({ waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            return await checkVerificationStatus(page);
        },
        
        // 策略4: 等待更长的时间
        async () => {
            console.log('🔄 尝试延长等待时间...');
            for (let i = 0; i < 6; i++) {
                await new Promise(resolve => setTimeout(resolve, 10000)); // 总共等待60秒
                const status = await checkVerificationStatus(page);
                if (status) return true;
                console.log(`⏳ 等待验证完成... (${i + 1}/6)`);
            }
            return false;
        }
    ];
    
    // 按顺序尝试各个策略
    for (let i = 0; i < strategies.length; i++) {
        console.log(`🔄 尝试备用策略 ${i + 1}/${strategies.length}...`);
        try {
            const success = await strategies[i]();
            if (success) {
                console.log(`✅ 备用策略 ${i + 1} 成功`);
                return true;
            }
        } catch (error) {
            console.log(`⚠️ 备用策略 ${i + 1} 失败:`, error.message);
        }
    }
    
    console.log('❌ 所有备用策略均失败');
    return false;
}

/**
 * 检查验证状态
 */
async function checkVerificationStatus(page) {
    return await page.evaluate(() => {
        const url = window.location.href.toLowerCase();
        
        // 检查是否还在验证页面
        const verificationElements = document.querySelectorAll(
            '#recaptcha, .g-recaptcha, .challenge-form, [class*="captcha"], [class*="challenge"]'
        );
        
        const hasVerificationElements = verificationElements.length > 0;
        const isVerificationUrl = url.includes('captcha') || url.includes('challenge') || url.includes('verify');
        
        return !hasVerificationElements && !isVerificationUrl;
    });
}

/**
 * 增强的验证完成等待函数
 */
async function waitForVerificationComplete(page) {
    console.log('🔍 等待验证完成，请手动处理验证...');
    WindowManager.instance?.alertWindow.show("log", "Please manually complete the verification");

    const startTime = Date.now();
    const timeout = 180000; // 3分钟超时

    let lastUrl = await page.url();
    let consecutiveStableChecks = 0;
    let verificationStep = 0;

    while (Date.now() - startTime < timeout) {
        try {
            const currentUrl = await page.url();
            
            // 检查验证状态
            const verificationStatus = await checkVerificationStatus(page);
            if (verificationStatus) {
                console.log('✅ 验证已完成');
                await new Promise(resolve => setTimeout(resolve, 3000));
                return true;
            }

            // URL 变化检测
            if (currentUrl !== lastUrl) {
                console.log(`🔄 页面跳转: ${currentUrl}`);
                lastUrl = currentUrl;
                consecutiveStableChecks = 0;
                verificationStep++;

                // 检查是否跳转到目标页面
                if (currentUrl.includes('/search') || 
                    currentUrl.includes('google.com/search') ||
                    currentUrl.includes('baidu.com/s') ||
                    currentUrl.includes('bing.com/search')) {
                    console.log('✅ 已跳转到搜索结果页面');
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    return true;
                }
            } else {
                consecutiveStableChecks++;
            }

            // 页面内容分析
            const pageState = await page.evaluate(() => {
                // 检查搜索结果元素
                const resultSelectors = [
                    '.g', '.tF2Cxc', '.yuRUbf', // Google
                    '.c-container', '.result', '.result-op', // Baidu
                    '.b_algo', '#b_results > li', // Bing
                    '.s-post-summary', '.question-summary' // Stack Overflow
                ];

                const hasResults = resultSelectors.some(selector =>
                    document.querySelector(selector)
                );

                // 检查验证元素
                const verificationSelectors = [
                    '#recaptcha', '.g-recaptcha', '.challenge-form',
                    '[class*="captcha"]', '[class*="challenge"]',
                    '[class*="verification"]', '.h-captcha'
                ];

                const stillVerifying = verificationSelectors.some(selector =>
                    document.querySelector(selector)
                );

                return {
                    hasResults,
                    stillVerifying,
                    title: document.title,
                    bodyText: document.body.textContent.substring(0, 100)
                };
            });

            console.log(`📊 验证状态检查 (步骤 ${verificationStep}):`, {
                hasResults: pageState.hasResults,
                stillVerifying: pageState.stillVerifying,
                title: pageState.title.substring(0, 50) + '...'
            });

            // 成功条件：有搜索结果且没有验证元素
            if (pageState.hasResults && !pageState.stillVerifying) {
                console.log('✅ 验证完成，检测到搜索结果');
                await new Promise(resolve => setTimeout(resolve, 3000));
                return true;
            }

            // 超时条件检查
            if (consecutiveStableChecks > 10) { // 20秒无变化
                console.log('🔄 长时间无变化，尝试交互...');
                // 尝试点击页面激活
                await page.mouse.move(100, 100);
                await page.mouse.click(100, 100);
                consecutiveStableChecks = 0;
            }

            // 等待2秒后再次检查
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.log('⚠️ 验证检查错误:', error.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    console.log('⏰ 验证等待超时');
    return false;
}

/**
 * 百度搜索 - Puppeteer 版本
 */
async function baiduSearch({ context, num_results = 5 }) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: false,
            devtools: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1400,1000'
            ],
            defaultViewport: {
                width: 1400,
                height: 1000
            }
        });

        const page = await browser.newPage();

        // 设置默认用户代理
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 监听控制台输出
        page.on('console', msg => {
            console.log('百度搜索控制台:', msg.type(), msg.text());
        });

        console.log(`正在使用百度搜索: ${context}`);

        const searchUrl = `https://www.baidu.com/s?ie=utf-8&tn=baidu&wd=${encodeURIComponent(context)}`;
        await page.goto(searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 15000
        });

        // 检查并处理验证
        await checkAndHandleVerification(page);

        // 等待搜索结果加载
        await new Promise(resolve => setTimeout(resolve, 3000));

        let allResults = [];
        let currentPage = 1;
        const maxPages = Math.ceil(num_results / 10);

        while (allResults.length < num_results && currentPage <= maxPages) {
            console.log(`正在解析百度第 ${currentPage} 页...`);

            const pageResults = await page.evaluate(({ currentCount, maxResults, currentPage }) => {
                const searchResults = [];
                const containers = document.querySelectorAll('#content_left .c-container, .result, .result-op');

                containers.forEach((container, ) => {
                    if (searchResults.length >= maxResults - currentCount) return;

                    const titleElement = container.querySelector('h3, .t, a');
                    const linkElement = container.querySelector('a');
                    const descElement = container.querySelector('.c-abstract, .content-right_8Zs40');

                    if (titleElement && linkElement) {
                        const title = titleElement.textContent.trim();
                        const url = linkElement.href;
                        const description = descElement ? descElement.textContent.trim() : '';

                        if (title && url) {
                            searchResults.push({
                                title: title,
                                url: url,
                                description: description,
                                page: currentPage
                            });
                        }
                    }
                });

                return searchResults;
            }, { currentCount: allResults.length, maxResults: num_results, currentPage });

            // 转换为标准格式 [{title, url}, ...]
            const formattedResults = pageResults.map(item => ({
                title: item.title,
                url: item.url
            }));

            allResults.push(...formattedResults);
            console.log(`第 ${currentPage} 页找到 ${formattedResults.length} 个结果`);

            // 如果有下一页且还需要更多结果，点击下一页
            if (allResults.length < num_results) {
                const hasNextPage = await page.evaluate(() => {
                    const nextLink = document.querySelector('a.n');
                    if (nextLink) {
                        nextLink.click();
                        return true;
                    }
                    return false;
                });

                if (hasNextPage) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {
                        console.log('导航超时，但继续处理当前页面');
                    });
                    currentPage++;
                } else {
                    break;
                }
            }
        }

        console.log(`百度搜索完成，找到 ${allResults.length} 个结果`);
        return allResults.slice(0, num_results);

    } catch (error) {
        console.error('百度搜索错误:', error.message);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Bing 搜索 - Puppeteer 版本（修复内容刷新问题）
 */
async function bingSearch({ context, num_results = 5 }) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: false,
            devtools: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1400,1000',
                '--disable-features=TranslateUI' // 禁用翻译功能，减少干扰
            ],
            defaultViewport: {
                width: 1400,
                height: 1000
            }
        });

        const page = await browser.newPage();

        // 设置默认用户代理
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 阻止不必要的资源加载，加快页面稳定
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`正在使用Bing搜索: ${context}`);

        const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(context)}`;
        
        // 使用更长的超时时间并等待页面完全稳定
        await page.goto(searchUrl, {
            waitUntil: ['domcontentloaded', 'networkidle0'], // 等待网络完全空闲
            timeout: 30000
        });

        // 检查并处理验证
        await checkAndHandleVerification(page);

        // 增加等待时间，确保页面完全稳定
        console.log('等待页面完全稳定...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 检查页面是否刷新或重定向
        let stableCount = 0;
        let lastTitle = '';
        
        for (let i = 0; i < 10; i++) {
            const currentTitle = await page.title();
            if (currentTitle === lastTitle) {
                stableCount++;
                if (stableCount >= 3) {
                    console.log('页面已稳定');
                    break;
                }
            } else {
                stableCount = 0;
                lastTitle = currentTitle;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        let allResults = [];
        let currentPage = 1;
        const maxPages = Math.ceil(num_results / 10);

        while (allResults.length < num_results && currentPage <= maxPages) {
            console.log(`正在解析Bing第 ${currentPage} 页...`);

            // 在解析前再次等待页面稳定
            await new Promise(resolve => setTimeout(resolve, 2000));

            const pageResults = await page.evaluate(({ currentCount, maxResults, currentPage }) => {
                const searchResults = [];

                // 更精确的选择器，专注于主要搜索结果
                const selectors = [
                    'li.b_algo',
                    '.b_algo',
                    '#b_results > li'
                ];

                let searchElements = [];
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    if (elements.length > 0) {
                        searchElements = Array.from(elements);
                        break;
                    }
                }

                // 过滤掉广告和其他非相关结果
                const filteredElements = searchElements.filter(element => {
                    // 排除广告
                    if (element.querySelector('.b_ad') || 
                        element.querySelector('[class*="ad"]') ||
                        element.textContent.includes('广告')) {
                        return false;
                    }
                    
                    // 确保有标题和链接
                    const hasTitle = element.querySelector('h2, a h2, .b_title h2, a');
                    const hasLink = element.querySelector('a[href]');
                    
                    return hasTitle && hasLink;
                });

                filteredElements.forEach((element, ) => {
                    if (searchResults.length >= maxResults - currentCount) return;

                    let title = '';
                    let url = '';
                    let description = '';

                    // 提取标题
                    const titleSelectors = ['h2 a', '.b_title a', 'a'];
                    for (const titleSelector of titleSelectors) {
                        const titleElement = element.querySelector(titleSelector);
                        if (titleElement) {
                            title = titleElement.textContent.trim();
                            if (title) {
                                // 同时获取URL
                                url = titleElement.href;
                                break;
                            }
                        }
                    }

                    // 如果还没找到URL，尝试其他链接
                    if (!url) {
                        const linkElement = element.querySelector('a[href]');
                        if (linkElement) {
                            url = linkElement.href;
                        }
                    }

                    // 提取描述
                    const descElement = element.querySelector('.b_caption p, .b_attribution, .b_snippet');
                    if (descElement) {
                        description = descElement.textContent.trim().substring(0, 200);
                    }

                    // 验证URL有效性并保存结果
                    if (url && title) {
                        try {
                            new URL(url);
                            // 进一步过滤不相关的结果
                            if (title.length > 5 && !title.includes('必应') && !title.includes('Bing')) {
                                searchResults.push({
                                    title: title,
                                    url: url,
                                    description: description,
                                    page: currentPage
                                });
                            }
                        } catch {
                            // 无效URL，跳过
                        }
                    }
                });

                return searchResults;
            }, { currentCount: allResults.length, maxResults: num_results, currentPage });

            // 转换为标准格式
            const formattedResults = pageResults.map(item => ({
                title: item.title,
                url: item.url
            }));

            allResults.push(...formattedResults);
            console.log(`第 ${currentPage} 页找到 ${formattedResults.length} 个结果`);

            // 如果已经获得足够结果，提前退出
            if (allResults.length >= num_results) {
                break;
            }

            // 翻页逻辑 - 更稳健的方式
            if (allResults.length < num_results) {
                const hasNextPage = await page.evaluate(() => {
                    const nextLink = document.querySelector('a.sb_pagN');
                    if (nextLink && !nextLink.disabled) {
                        nextLink.click();
                        return true;
                    }
                    return false;
                });

                if (hasNextPage) {
                    console.log('跳转到下一页...');
                    // 等待导航完成
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    
                    // 不严格等待导航，而是检查页面是否已更新
                    try {
                        await page.waitForNavigation({ 
                            waitUntil: 'domcontentloaded', 
                            timeout: 10000 
                        });
                    } catch {
                        console.log('导航超时，继续处理当前状态');
                    }
                    
                    currentPage++;
                } else {
                    console.log('没有更多页面');
                    break;
                }
            }
        }

        console.log(`Bing搜索完成，找到 ${allResults.length} 个结果`);
        return allResults.slice(0, num_results);

    } catch (error) {
        console.error('Bing搜索错误:', error.message);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * 谷歌搜索 - Puppeteer 版本
 */
async function googleSearch({ context, num_results = 5 }) {
    let browser = null;
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
        });

        // 设置默认用户代理
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });

        page.on('console', msg => {
            console.log('谷歌搜索控制台:', msg.type(), msg.text());
        });

        console.log(`正在使用谷歌搜索: ${context}`);

        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(context)}&hl=en`;
        await page.goto(searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 20000
        });

        // 检查并处理验证
        await checkAndHandleVerification(page);

        // 处理可能的同意页面
        await new Promise(resolve => setTimeout(resolve, 5000));
        const currentUrl = page.url();

        if (currentUrl.includes('consent.google.com') || currentUrl.includes('signin')) {
            console.log('检测到谷歌同意页面或登录页面，尝试处理...');

            // 尝试点击同意按钮
            try {
                await page.click('button:contains("I agree"), button:contains("Accept all"), [aria-label="Accept all"]');
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch {
                console.log('无法处理同意页面，继续...');
            }
        }

        let allResults = [];
        let currentPage = 1;
        const maxPages = Math.ceil(num_results / 10);

        while (allResults.length < num_results && currentPage <= maxPages) {
            console.log(`正在解析谷歌第 ${currentPage} 页...`);

            const pageResults = await page.evaluate(({ currentCount, maxResults, currentPage }) => {
                const searchResults = [];

                // 谷歌搜索结果选择器
                const resultSelectors = [
                    '.g',
                    '.tF2Cxc',
                    '.yuRUbf',
                    'div[data-sokoban-container]'
                ];

                let results = [];
                for (const selector of resultSelectors) {
                    results = document.querySelectorAll(selector);
                    if (results.length > 0) break;
                }

                results.forEach((result, ) => {
                    if (searchResults.length >= maxResults - currentCount) return;

                    let title = '';
                    let url = '';
                    let description = '';

                    // 提取标题
                    const titleElement = result.querySelector('h3, .LC20lb, .DKV0Md');
                    if (titleElement) {
                        title = titleElement.textContent.trim();
                    }

                    // 提取链接
                    const linkElement = result.querySelector('a[href]');
                    if (linkElement) {
                        url = linkElement.href;
                        // 如果是谷歌重定向链接，尝试获取真实URL
                        if (url.startsWith('/url?q=')) {
                            const match = url.match(/\/url\?q=([^&]+)/);
                            if (match) {
                                url = decodeURIComponent(match[1]);
                            }
                        }
                    }

                    // 提取描述
                    const descElement = result.querySelector('.VwiC3b, .MUxGbd, .s3v9rd');
                    if (descElement) {
                        description = descElement.textContent.trim();
                    }

                    if (title && url) {
                        try {
                            const urlObj = new URL(url);
                            if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
                                searchResults.push({
                                    title: title,
                                    url: url,
                                    description: description,
                                    page: currentPage
                                });
                            }
                        } catch {
                            // 无效URL，跳过
                        }
                    }
                });

                return searchResults;
            }, { currentCount: allResults.length, maxResults: num_results, currentPage });

            // 转换为标准格式
            const formattedResults = pageResults.map(item => ({
                title: item.title,
                url: item.url
            }));

            allResults.push(...formattedResults);
            console.log(`第 ${currentPage} 页找到 ${formattedResults.length} 个结果`);

            // 谷歌翻页逻辑
            if (allResults.length < num_results) {
                const hasNextPage = await page.evaluate(() => {
                    // 查找下一页按钮
                    const nextSelectors = [
                        '#pnnext',
                        'a[aria-label="Next page"]',
                        'a:contains("Next")',
                        '.d6cvqb > a:last-child'
                    ];

                    for (const selector of nextSelectors) {
                        const nextLink = document.querySelector(selector);
                        if (nextLink) {
                            nextLink.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (hasNextPage) {
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    await page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: 15000
                    }).catch(() => {
                        console.log('谷歌导航超时，但继续处理当前页面');
                    });
                    currentPage++;
                } else {
                    break;
                }
            }
        }

        console.log(`谷歌搜索完成，找到 ${allResults.length} 个结果`);
        return allResults.slice(0, num_results);

    } catch (error) {
        console.error('谷歌搜索错误:', error.message);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * 获取工具提示
 */
function getPrompt() {
    return `## fetch_search

Description: Perform online search using Baidu, Bing or Google with browser automation

Parameters:
- context: (Required) Search keywords
- num_results: (Optional) Number of search results, default is 5
- engine: (Optional) Search engine, 'baidu', 'bing' or 'google', default is 'baidu'

Features:
- Uses real browser to avoid anti-bot detection
- Supports multi-page search results
- Returns standardized format: [{title, url}, ...]
- Integrated verification handling

Usage:
{
  "tool": "fetch_search",
  "params": {
    "context": "search keywords",
    "num_results": 5,
    "engine": "baidu"
  }
}

Response Format:
[
  {"title": "Result Title 1", "url": "https://example.com/1"},
  {"title": "Result Title 2", "url": "https://example.com/2"}
]`;
}

// 测试函数
if (require.main === module) {
    (async () => {
        try {
            console.log('开始搜索测试...');

            const fullResults = await main({
                context: '10x Genomics PBMC single cell multiomics data download RNA-seq ATAC-seq',
                num_results: 5,
                engine: 'baidu'
            });

            console.log('完整搜索结果:', fullResults);

        } catch (error) {
            console.error('测试错误:', error.message);
        }
    })();
}

module.exports = {
    main,
    baiduSearch,
    bingSearch,
    googleSearch,
    getPrompt
};