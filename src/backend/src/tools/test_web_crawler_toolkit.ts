/**
 * WebCrawlerToolkit 真实网络请求单元测试
 * 
 * 测试要求：
 * 1. 设置代理环境变量: $env:https_proxy = "http://127.0.0.1:7890"
 * 2. 运行测试: npx ts-node test_web_crawler_toolkit.ts
 */

import { 
    DuckDuckGoSearch, 
    BaiduSearch, 
    ContentFetcher, 
    WebCrawlerToolkit,
    SearchResultItem 
} from './web_crawler_toolkit';

// ==================== 测试配置 ====================
const TEST_CONFIG = {
    proxyUrl: process.env.https_proxy || process.env.HTTPS_PROXY || 'http://127.0.0.1:7890',
    testUrl: 'https://www.baidu.com',
    testQuery: 'TypeScript tutorial',
    maxLength: 5000,
    timeout: 15000
};

// ==================== 测试工具函数 ====================
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passedTests++;
    } else {
        console.log(`  ❌ FAIL: ${message}`);
        failedTests++;
    }
}

function section(name: string): void {
    console.log(`\n📂 ${name}`);
    console.log('─'.repeat(50));
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 测试用例 ====================

async function testProxyConfiguration(): Promise<void> {
    section('测试1: 代理配置检查');
    
    const proxyUrl = TEST_CONFIG.proxyUrl;
    console.log(`  检测到代理: ${proxyUrl}`);
    
    assert(proxyUrl.includes('127.0.0.1'), '代理地址应为 localhost');
    assert(proxyUrl.startsWith('http'), '代理地址应为 http/https 协议');
}

async function testBaiduSearch(): Promise<void> {
    section('测试2: 百度搜索 (BaiduSearch)');
    
    const searcher = new BaiduSearch(3);
    
    try {
        console.log(`  搜索词: "${TEST_CONFIG.testQuery}"`);
        const results = await searcher.search(TEST_CONFIG.testQuery);
        
        assert(typeof results === 'object', '返回结果应为对象');
        assert(Object.keys(results).length > 0, '应返回至少1条搜索结果');
        
        // 验证结果格式
        const firstResult = results[0];
        assert(typeof firstResult.url === 'string' && firstResult.url.length > 0, '结果应包含有效URL');
        assert(typeof firstResult.title === 'string' && firstResult.title.length > 0, '结果应包含标题');
        assert(typeof firstResult.summ === 'string', '结果应包含摘要');
        
        console.log(`  ✅ 获得 ${Object.keys(results).length} 条结果`);
        console.log(`  示例: ${firstResult.title.substring(0, 50)}...`);
        
    } catch (error: any) {
        console.log(`  ❌ 搜索失败: ${error.message}`);
        assert(false, '百度搜索应成功执行');
    }
}

async function testDuckDuckGoSearch(): Promise<void> {
    section('测试3: DuckDuckGo搜索 (DuckDuckGoSearch)');
    
    const searcher = new DuckDuckGoSearch(3);
    
    try {
        console.log(`  搜索词: "${TEST_CONFIG.testQuery}"`);
        const results = await searcher.search(TEST_CONFIG.testQuery);
        
        // DuckDuckGoSearch 可能返回 { error: string }
        if ('error' in results) {
            console.log(`  ⚠️  DuckDuckGo 返回错误: ${results.error}`);
            assert(false, 'DuckDuckGo 搜索应成功');
            return;
        }
        
        assert(typeof results === 'object', '返回结果应为对象');
        assert(Object.keys(results).length > 0, '应返回至少1条搜索结果');
        
        const firstResult = results[0];
        assert(typeof firstResult.url === 'string', '结果应包含URL');
        assert(typeof firstResult.title === 'string', '结果应包含标题');
        
        console.log(`  ✅ 获得 ${Object.keys(results).length} 条结果`);
        
    } catch (error: any) {
        console.log(`  ❌ 搜索失败: ${error.message}`);
        assert(false, 'DuckDuckGo 搜索应成功执行');
    }
}

async function testContentFetcher(): Promise<void> {
    section('测试4: 内容获取器 (ContentFetcher)');
    
    const fetcher = new ContentFetcher();
    
    try {
        console.log(`  抓取URL: ${TEST_CONFIG.testUrl}`);
        const [success, content] = await fetcher.fetch(TEST_CONFIG.testUrl, TEST_CONFIG.maxLength);
        
        assert(success === true, '应成功获取内容');
        assert(typeof content === 'string' && content.length > 0, '内容不应为空');
        assert(content.length <= TEST_CONFIG.maxLength + 100, '内容应被正确截断');
        
        // 检查是否移除了脚本和样式
        assert(!content.includes('<script>'), '内容不应包含脚本标签');
        assert(!content.includes('<style>'), '内容不应包含样式标签');
        
        console.log(`  ✅ 成功获取 ${content.length} 字符内容`);
        console.log(`  预览: ${content.substring(0, 100)}...`);
        
    } catch (error: any) {
        console.log(`  ❌ 获取失败: ${error.message}`);
        assert(false, '内容获取应成功执行');
    }
}

async function testWebCrawlerToolkitIntegration(): Promise<void> {
    section('测试5: 集成测试 (WebCrawlerToolkit)');
    
    const toolkit = new WebCrawlerToolkit({ topk: 3 });
    
    try {
        // 测试搜索
        console.log(`  执行搜索: "${TEST_CONFIG.testQuery}"`);
        const searchResults = await toolkit.search(TEST_CONFIG.testQuery);
        
        assert(typeof searchResults === 'object', '搜索应返回对象');
        assert(Object.keys(searchResults).length > 0, '应返回搜索结果');
        
        console.log(`  ✅ 搜索返回 ${Object.keys(searchResults).length} 条结果`);
        
        // 测试 select
        const firstId = 0;
        if (searchResults[firstId]) {
            console.log(`  执行内容抓取 (ID: ${firstId})`);
            const selectedResults = await toolkit.select([firstId], TEST_CONFIG.maxLength);
            
            assert(typeof selectedResults === 'object', '选择应返回对象');
            assert(selectedResults[firstId] !== undefined, '应包含指定ID的结果');
            assert(selectedResults[firstId].content !== undefined, '结果应包含内容');
            
            console.log(`  ✅ 成功抓取内容，长度: ${selectedResults[firstId].content?.length || 0}`);
        }
        
        // 测试 readUrl
        console.log(`  执行直接URL读取`);
        const urlResult = await toolkit.readUrl(TEST_CONFIG.testUrl, TEST_CONFIG.maxLength);
        
        assert(urlResult.type === 'text', '应返回文本类型');
        assert(typeof urlResult.content === 'string' && urlResult.content.length > 0, '应有内容');
        
        console.log(`  ✅ URL读取成功`);
        
    } catch (error: any) {
        console.log(`  ❌ 集成测试失败: ${error.message}`);
        assert(false, '集成测试应成功执行');
    }
}

async function testCheckStatus(): Promise<void> {
    section('测试6: URL状态检查 (checkStatus)');
    
    const toolkit = new WebCrawlerToolkit();
    
    try {
        // 测试有效URL
        console.log(`  检查URL: ${TEST_CONFIG.testUrl}`);
        const validResult = await toolkit.checkStatus(TEST_CONFIG.testUrl, 5000);
        
        assert(typeof validResult === 'object', '应返回结果对象');
        assert(validResult.status !== 'error', '状态不应为error');
        
        console.log(`  ✅ 状态检查成功: ${validResult.accessible ? '可访问' : '不可访问'}`);
        
    } catch (error: any) {
        console.log(`  ❌ 状态检查失败: ${error.message}`);
        assert(false, '状态检查应成功执行');
    }
}

async function testCacheMechanism(): Promise<void> {
    section('测试7: 缓存机制测试');
    
    const searcher = new BaiduSearch(3);
    
    try {
        const query = 'cache test ' + Date.now();
        console.log(`  搜索词: "${query}"`);
        
        // 第一次搜索
        const start1 = Date.now();
        await searcher.search(query);
        const time1 = Date.now() - start1;
        console.log(`  第一次搜索耗时: ${time1}ms`);
        
        // 等待一小段时间确保缓存生效
        await sleep(100);
        
        // 第二次搜索（应使用缓存）
        const start2 = Date.now();
        await searcher.search(query);
        const time2 = Date.now() - start2;
        console.log(`  第二次搜索耗时: ${time2}ms`);
        
        assert(time2 < time1 * 0.5, '第二次搜索应明显更快（使用缓存）');
        console.log(`  ✅ 缓存生效，第二次请求快 ${((time1 - time2) / time1 * 100).toFixed(0)}%`);
        
    } catch (error: any) {
        console.log(`  ❌ 缓存测试失败: ${error.message}`);
        assert(false, '缓存测试应成功执行');
    }
}

// ==================== 主测试运行器 ====================

async function runAllTests(): Promise<void> {
    console.log('═'.repeat(60));
    console.log('🧪 WebCrawlerToolkit 真实网络请求单元测试');
    console.log('═'.repeat(60));
    console.log(`\n📡 代理配置: ${TEST_CONFIG.proxyUrl}`);
    console.log(`⏱️  超时设置: ${TEST_CONFIG.timeout}ms`);
    
    // 检查代理是否配置
    if (!TEST_CONFIG.proxyUrl) {
        console.log('\n⚠️  警告: 未检测到代理配置');
        console.log('   建议设置: $env:https_proxy = "http://127.0.0.1:7890"');
    }
    
    // 等待代理生效
    await sleep(500);
    
    try {
        await testProxyConfiguration();
        await testBaiduSearch();
        await sleep(1000); // 避免请求过快
        
        await testDuckDuckGoSearch();
        await sleep(1000);
        
        await testContentFetcher();
        await sleep(1000);
        
        await testWebCrawlerToolkitIntegration();
        await sleep(1000);
        
        await testCheckStatus();
        await sleep(500);
        
        await testCacheMechanism();
        
    } catch (error: any) {
        console.error(`\n💥 测试执行异常: ${error.message}`);
        failedTests++;
    }
    
    // 输出测试结果汇总
    console.log('\n' + '═'.repeat(60));
    console.log('📊 测试结果汇总');
    console.log('═'.repeat(60));
    console.log(`  ✅ 通过: ${passedTests}`);
    console.log(`  ❌ 失败: ${failedTests}`);
    console.log(`  📈 总计: ${passedTests + failedTests}`);
    
    if (failedTests === 0) {
        console.log('\n🎉 所有测试通过！代理配置正常。');
        process.exit(0);
    } else {
        console.log('\n⚠️  部分测试失败，请检查代理配置和网络连接。');
        process.exit(1);
    }
}

// 执行测试
runAllTests();
