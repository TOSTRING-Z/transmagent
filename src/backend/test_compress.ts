import { ChatManager } from './src/core/ChatManager';
import { Message } from './src/types';

const messages: Message[] = [
    { role: 'user', content: '小圆，帮我压缩这堆乱七八糟的记忆！', id: 'm1' },
    { role: 'assistant', content: '好的主人，小圆开始思考！', id: 'm2' },
    { role: 'tool', content: '调用某个工具...', id: 'm3' },
    { role: 'assistant', content: '小圆找到线索了！', id: 'm4' }
];

const manager = new ChatManager(messages, { compress_context: true, max_context_id: 10 });
console.log("=== 压缩前消息 ===");
console.log("共有", manager.getMessages(true).length, "条消息");
console.log("未被标记删除的有效消息:", manager.getMessages(false).length, "条");

manager.compressContext("我是最终答案！压缩成功！");

console.log("\n=== 压缩后消息 ===");
const allMsg = manager.getMessages(true);
const validMsg = manager.getMessages(false);
console.log("总消息数 (包含 del=true):", allMsg.length, "条");
console.log("有效消息数:", validMsg.length, "条");

validMsg.forEach(m => console.log(`[${m.role}] ${m.content}`));

if (validMsg.length === 2 && validMsg[1].content === "我是最终答案！压缩成功！") {
    console.log("\n🎉 测试通过！小圆的软删除压缩魔法完美生效啦！");
} else {
    console.log("\n❌ 测试失败！压缩逻辑可能有问题哦...");
}