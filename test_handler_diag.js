/**
 * 诊断脚本：验证 BackgroundTaskRegistry registerHandler/addMessage 机制
 * 直接加载编译后的 JS 模块
 */
const path = require('path');
const distDir = path.resolve(__dirname, 'src', 'backend', 'dist');

// Mock 依赖
const mockLogger = {
    log: (...args) => console.log('[LOGGER]', ...args),
    error: (...args) => console.log('[LOGGER_ERR]', ...args),
    warn: (...args) => console.log('[LOGGER_WARN]', ...args),
};

// 注入 mock logger 到模块缓存
require.cache[require.resolve(path.join(distDir, 'utils', 'logger.js'))] = {
    id: require.resolve(path.join(distDir, 'utils', 'logger.js')),
    exports: { logger: mockLogger },
    loaded: true,
};

// 加载 BackgroundTaskRegistry
const BTR = require(path.join(distDir, 'core', 'BackgroundTaskRegistry.js'));

async function test() {
    console.log('\n========== 诊断开始 ==========');

    const sessionId = 'diag-session-' + Date.now();
    const taskId = 'diag-task-' + Date.now();

    let handlerCalled = false;
    let receivedMsg = null;

    // 1. 注册 handler
    console.log('\n1. 注册 handler...');
    BTR.BackgroundTaskRegistry.registerHandler(sessionId, (msg) => {
        handlerCalled = true;
        receivedMsg = msg;
        console.log('   >>> Handler 被调用了！msg:', JSON.stringify(msg));
    });

    // 2. 检查 handlers 静态 Map
    console.log('\n2. 检查 handlers 状态...');
    // handlers 是 private static，我们无法直接访问

    // 3. 调用 addMessage
    console.log('\n3. 调用 addMessage...');
    BTR.BackgroundTaskRegistry.addMessage(sessionId, taskId, 'Test message content');

    // 4. 验证
    console.log('\n4. 验证结果:');
    console.log('   handlerCalled:', handlerCalled);
    if (handlerCalled) {
        console.log('   ✅ Handler 机制正常工作！');
    } else {
        console.log('   ❌ Handler 未被调用！');
    }

    // 5. 测试 addMessage BEFORE registerHandler (离线排队)
    console.log('\n5. 测试离线排队...');
    const sessionId2 = 'diag-session-2-' + Date.now();
    const taskId2a = 'diag-task-2a-' + Date.now();
    const taskId2b = 'diag-task-2b-' + Date.now();

    BTR.BackgroundTaskRegistry.addMessage(sessionId2, taskId2a, 'Queued message 1');
    BTR.BackgroundTaskRegistry.addMessage(sessionId2, taskId2b, 'Queued message 2');

    let queuedCount = 0;
    BTR.BackgroundTaskRegistry.registerHandler(sessionId2, (msg) => {
        queuedCount++;
        console.log(`   >>> 排队消息 ${queuedCount} 投递:`, msg.taskId);
    });

    console.log('   queuedCount:', queuedCount);
    console.log(queuedCount === 2 ? '   ✅ 离线排队正常 (2/2)' : '   ❌ 离线排队异常');

    console.log('\n========== 诊断完成 ==========');
}

test().catch(err => {
    console.error('Diagnostic error:', err);
    process.exit(1);
});
