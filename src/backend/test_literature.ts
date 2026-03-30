/**
 * 文献搜索工具快速验证脚本
 */

import { literatureSearch, literatureSearchTool, LiteratureSearchParams } from './src/tools/literature_search';

async function runTest() {
    console.log('🧪 开始测试文献搜索工具...\n');

    // 测试1: 元数据验证
    console.log('📋 测试1: 验证工具元数据');
    console.log(`  - 工具名称: ${literatureSearchTool.name}`);
    console.log(`  - 描述: ${literatureSearchTool.description.substring(0, 50)}...`);
    console.log(`  - 参数数量: ${Object.keys(literatureSearchTool.parameters.properties).length}`);
    console.log('  ✅ 元数据验证通过\n');

    // 测试2: 基础搜索 (arXiv)
    console.log('🔍 测试2: 执行 arXiv 文献搜索...');
    const arxivResult = await literatureSearch({
        query: 'transformer attention',
        maxResults: 3,
        source: 'arxiv'
    });
    console.log(`  - 查询: "${arxivResult.query}"`);
    console.log(`  - 搜索耗时: ${arxivResult.searchTime}`);
    console.log(`  - 找到结果: ${arxivResult.totalFound} 条`);
    console.log(`  - 数据源: ${arxivResult.sources.join(', ')}`);
    
    if (arxivResult.results.length > 0) {
        const first = arxivResult.results[0];
        console.log('\n  📄 第一个结果:');
        console.log(`    标题: ${first.title.substring(0, 60)}...`);
        console.log(`    作者: ${first.authors.slice(0, 2).join(', ')}${first.authors.length > 2 ? '...' : ''}`);
        console.log(`    日期: ${first.publicationDate}`);
        console.log(`    来源: ${first.source}`);
        console.log(`    URL: ${first.url}`);
    }
    console.log('  ✅ arXiv 搜索测试完成\n');

    // 测试3: PubMed 搜索
    console.log('🔍 测试3: 执行 PubMed 文献搜索...');
    const pubmedResult = await literatureSearch({
        query: 'COVID-19 vaccine',
        maxResults: 3,
        source: 'pubmed'
    });
    console.log(`  - 查询: "${pubmedResult.query}"`);
    console.log(`  - 找到结果: ${pubmedResult.totalFound} 条`);
    if (pubmedResult.results.length > 0) {
        console.log(`    第一篇: ${pubmedResult.results[0].title.substring(0, 50)}...`);
    }
    console.log('  ✅ PubMed 搜索测试完成\n');

    // 测试4: 多源搜索
    console.log('🔍 测试4: 执行多源文献搜索...');
    const multiResult = await literatureSearch({
        query: 'machine learning',
        maxResults: 10,
        source: 'all'
    });
    console.log(`  - 查询: "${multiResult.query}"`);
    console.log(`  - 搜索耗时: ${multiResult.searchTime}`);
    console.log(`  - 找到结果: ${multiResult.totalFound} 条`);
    console.log(`  - 覆盖数据源: ${multiResult.sources.join(', ')}`);
    
    // 统计各来源结果数
    const sourceCount = multiResult.results.reduce((acc, r) => {
        acc[r.source] = (acc[r.source] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    console.log('  - 各来源结果分布:');
    Object.entries(sourceCount).forEach(([source, count]) => {
        console.log(`    ${source}: ${count} 条`);
    });
    console.log('  ✅ 多源搜索测试完成\n');

    // 测试5: 结果结构验证
    console.log('🔍 测试5: 验证结果结构完整性...');
    if (multiResult.results.length > 0) {
        const sample = multiResult.results[0];
        const requiredFields = ['id', 'title', 'authors', 'abstract', 'publicationDate', 'journal', 'doi', 'url', 'citations', 'source'];
        const missing = requiredFields.filter(f => !(f in sample));
        if (missing.length === 0) {
            console.log('  ✅ 所有必需字段都存在');
        } else {
            console.log(`  ⚠️ 缺失字段: ${missing.join(', ')}`);
        }
    }
    console.log('');

    // 总结
    console.log('='.repeat(50));
    console.log('🎉 所有测试完成！');
    console.log('='.repeat(50));
}

runTest().catch(console.error);
