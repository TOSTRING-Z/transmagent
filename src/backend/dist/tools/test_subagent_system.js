"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 子代理系统集成测试
 * 测试：BackgroundTaskRegistry 代理消息路由 + send_message 工具
 * 运行：npx ts-node src/backend/src/tools/test_subagent_system.ts
 */
const BackgroundTaskRegistry_1 = require("../core/BackgroundTaskRegistry");
// ─── 测试工具函数 ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ PASS: ${testName}`);
        passed++;
    }
    else {
        console.log(`  ❌ FAIL: ${testName}`);
        failed++;
    }
}
// ─── 测试 1：AgentListener 注册/注销 ──────────────────────────────────────
console.log('\n📋 测试1: AgentListener 注册与注销');
{
    const sessionId = 'test-session-001';
    const agentName = 'worker_a';
    let receivedMessages = [];
    const listener = (msg) => { receivedMessages.push(msg); };
    // 注册
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, agentName, listener);
    // 发送消息
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'worker_b', 'worker_a', 'Hello from B!');
    assert(receivedMessages.length === 1, '消息应被投递到 listener');
    assert(receivedMessages[0].from === 'worker_b', '消息来源应为 worker_b');
    assert(receivedMessages[0].content === 'Hello from B!', '消息内容应匹配');
    // 注销
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, agentName);
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'worker_b', 'worker_a', 'Second message');
    assert(receivedMessages.length === 1, '注销后不应再收到消息');
}
// ─── 测试 2：addAgentMessage 路由逻辑 ─────────────────────────────────────
console.log('\n📋 测试2: addAgentMessage 路由 — target="main"');
{
    const sessionId = 'test-session-002';
    // 清除之前可能残留的 pending
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'worker_a', 'main', '任务完成！');
    // 验证消息已通过 addMessage 注入（addMessage 是现有方法）
    // 此处仅验证不抛异常
    assert(true, 'target=main 路由不抛异常');
}
console.log('\n📋 测试2b: addAgentMessage 路由 — target="all" 广播');
{
    const sessionId = 'test-session-003';
    const msgsA = [];
    const msgsB = [];
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, 'agent_a', (m) => msgsA.push(m));
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, 'agent_b', (m) => msgsB.push(m));
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'controller', 'all', '广播消息');
    // agent_a 和 agent_b 都应收到（但 controller 自身不应收到）
    assert(msgsA.length === 1, 'agent_a 应收到广播');
    assert(msgsB.length === 1, 'agent_b 应收到广播');
    assert(msgsA[0].from === 'controller', '广播来源正确');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, 'agent_a');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, 'agent_b');
}
console.log('\n📋 测试2c: addAgentMessage 路由 — target=特定代理（离线排队）');
{
    const sessionId = 'test-session-004';
    const agentName = 'late_joiner';
    // 目标代理未注册 → 应排队
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'worker_a', agentName, '离线消息');
    // 后来注册 → 应立即收到排队消息
    const msgs = [];
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, agentName, (m) => msgs.push(m));
    assert(msgs.length === 1, '延迟注册后应立即收到排队消息');
    assert(msgs[0].content === '离线消息', '排队消息内容应正确');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, agentName);
}
// ─── 测试 3：drainAgentMessages ───────────────────────────────────────────
console.log('\n📋 测试3: drainAgentMessages 排空机制（无 listener 时排队）');
{
    const sessionId = 'test-session-005';
    const agentName = 'drain_test';
    // 不注册 listener → 消息进入排队队列
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'sender1', agentName, 'msg1');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'sender2', agentName, 'msg2');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'sender3', agentName, 'msg3');
    // drainAgentMessages 返回排队消息并清除
    const drained = BackgroundTaskRegistry_1.BackgroundTaskRegistry.drainAgentMessages(sessionId, agentName);
    assert(drained.length === 3, 'drain 应返回 3 条排队消息');
    assert(drained[0].content === 'msg1', '第一条排队消息正确');
    assert(drained[2].content === 'msg3', '最后一条排队消息正确');
    // 再次 drain 应为空
    const drained2 = BackgroundTaskRegistry_1.BackgroundTaskRegistry.drainAgentMessages(sessionId, agentName);
    assert(drained2.length === 0, '第二次 drain 应为空');
}
// ─── 测试 4：send_message 工具函数 ────────────────────────────────────────
console.log('\n📋 测试4: send_message 工具逻辑（通过 BackgroundTaskRegistry 验证）');
{
    const sessionId = 'test-session-006';
    const fromAgent = 'data_processor';
    const toAgent = 'report_writer';
    const msgs = [];
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, toAgent, (m) => msgs.push(m));
    // 模拟 send_message 内部调用
    const msgContent = '请基于此数据生成报告';
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, fromAgent, toAgent, msgContent);
    assert(msgs.length === 1, '定向消息应被投递');
    assert(msgs[0].from === fromAgent, '来源应为 data_processor');
    assert(msgs[0].content === msgContent, '内容应匹配');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, toAgent);
}
// ─── 测试 5：多代理网状通信 ──────────────────────────────────────────────
console.log('\n📋 测试5: 多代理网状通信拓扑');
{
    const sessionId = 'test-session-007';
    // 模拟 3 个子代理
    const inbox = {
        'researcher': [],
        'analyst': [],
        'writer': [],
    };
    for (const [name, box] of Object.entries(inbox)) {
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, name, (m) => box.push(m));
    }
    // researcher → analyst
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'researcher', 'analyst', '原始数据已就绪');
    // researcher → writer
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'researcher', 'writer', '请准备报告模板');
    // analyst → writer
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'analyst', 'writer', '分析结果：p<0.05');
    // writer → all (报告完成广播)
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, 'writer', 'all', '报告已完成！');
    assert(inbox['researcher'].length === 1, 'researcher 应收到 writer 的广播（1条）');
    assert(inbox['analyst'].length === 2, 'analyst 应收到 researcher 消息 + writer 广播（2条）');
    assert(inbox['writer'].length === 2, 'writer 应收到 researcher 消息 + analyst 消息（2条）');
    // 验证 writer 不应收到自己的广播
    const writerMsgsFromSelf = inbox['writer'].filter(m => m.from === 'writer');
    assert(writerMsgsFromSelf.length === 0, 'writer 不应收到自己的广播消息');
    // 验证消息时间戳
    assert(typeof inbox['analyst'][0].timestamp === 'number', '消息应有时间戳');
    for (const name of Object.keys(inbox)) {
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, name);
    }
}
// ─── 测试 6：并发安全性 ───────────────────────────────────────────────────
console.log('\n📋 测试6: 并发消息投递');
{
    const sessionId = 'test-session-008';
    const agentName = 'busy_agent';
    const msgs = [];
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionId, agentName, (m) => msgs.push(m));
    // 快速连续发送多条消息
    const count = 50;
    for (let i = 0; i < count; i++) {
        BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionId, `sender_${i}`, agentName, `message_${i}`);
    }
    assert(msgs.length === count, `应收到 ${count} 条消息`);
    assert(msgs[0].content === 'message_0', '消息顺序应正确');
    assert(msgs[count - 1].content === `message_${count - 1}`, '最后一条消息应正确');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionId, agentName);
}
// ─── 测试 7：不同 session 隔离 ────────────────────────────────────────────
console.log('\n📋 测试7: 跨 Session 隔离');
{
    const sessionA = 'session-aaa';
    const sessionB = 'session-bbb';
    const agentName = 'shared_name';
    const msgsA = [];
    const msgsB = [];
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionA, agentName, (m) => msgsA.push(m));
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.registerAgentListener(sessionB, agentName, (m) => msgsB.push(m));
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.addAgentMessage(sessionA, 'sender', agentName, 'message for A');
    assert(msgsA.length === 1, 'Session A 应收到消息');
    assert(msgsB.length === 0, 'Session B 不应收到消息');
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionA, agentName);
    BackgroundTaskRegistry_1.BackgroundTaskRegistry.unregisterAgentListener(sessionB, agentName);
}
// ─── 结果汇总 ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`  测试完成: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 项`);
console.log('='.repeat(60));
if (failed > 0) {
    process.exit(1);
}
else {
    console.log('✅ 所有测试通过！子代理通信系统工作正常。\n');
    process.exit(0);
}
//# sourceMappingURL=test_subagent_system.js.map