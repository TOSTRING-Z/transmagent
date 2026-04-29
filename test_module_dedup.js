/**
 * 诊断脚本：检测 BackgroundTaskRegistry 是否在 dist/ 中有多个副本
 */
const path = require('path');
const fs = require('fs');

const distDir = path.resolve(__dirname, 'src', 'backend', 'dist');

// 查找所有 BackgroundTaskRegistry.js 文件
function findFiles(dir, pattern, results = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            findFiles(fullPath, pattern, results);
        } else if (entry.isFile() && entry.name === pattern) {
            results.push(fullPath);
        }
    }
    return results;
}

const copies = findFiles(path.resolve(__dirname), 'BackgroundTaskRegistry.js');
console.log('BackgroundTaskRegistry.js 副本:');
copies.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

if (copies.length > 1) {
    console.log('\n⚠️  发现多个副本！模块可能被重复加载');
} else if (copies.length === 1) {
    console.log('\n✅ 只有一个副本');
} else {
    console.log('\n❌ 找不到 BackgroundTaskRegistry.js');
}

// 模拟两个不同路径的 require，检查是否是同一个实例
console.log('\n--- 模块实例测试 ---');
delete require.cache[require.resolve(path.join(distDir, 'core', 'BackgroundTaskRegistry.js'))];
delete require.cache[require.resolve(path.join(distDir, 'core', 'BackgroundTaskRegistry.js'))];

// Mock logger
const mockLogger = {
    log: () => {}, error: () => {}, warn: () => {},
};
require.cache[require.resolve(path.join(distDir, 'utils', 'logger.js'))] = {
    id: require.resolve(path.join(distDir, 'utils', 'logger.js')),
    exports: { logger: mockLogger },
    loaded: true,
};

const BTR1 = require(path.join(distDir, 'core', 'BackgroundTaskRegistry.js'));
// Clear cache and load again
delete require.cache[require.resolve(path.join(distDir, 'core', 'BackgroundTaskRegistry.js'))];
const BTR2 = require(path.join(distDir, 'core', 'BackgroundTaskRegistry.js'));

console.log('BTR1 === BTR2:', BTR1 === BTR2);
console.log('BTR1.BackgroundTaskRegistry === BTR2.BackgroundTaskRegistry:', BTR1.BackgroundTaskRegistry === BTR2.BackgroundTaskRegistry);
