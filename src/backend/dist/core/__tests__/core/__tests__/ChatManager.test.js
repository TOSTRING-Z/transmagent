"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var ChatManager_1 = require("../ChatManager");
describe('ChatManager.fixMessages', function () {
    var createToolCall = function (id, name) { return ({
        id: id,
        type: 'function',
        function: {
            name: name,
            arguments: '{}'
        }
    }); };
    var createMessage = function (partial) {
        var msg = __assign({ group_id: 'default', context_id: 'ctx-1', role: 'user', content: '', show: true, react: false }, partial);
        return msg;
    };
    describe('场景1: 最后一条是 user 消息', function () {
        it('应该弹出 user 消息', function () {
            var messages = [
                createMessage({ role: 'user', content: 'Hello', group_id: 'g1' }),
                createMessage({ role: 'user', content: 'Interrupted', group_id: 'g2' })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            expect(chatManager.messages.length).toBe(1);
            expect(chatManager.messages[0].content).toBe('Hello');
        });
    });
    describe('场景2: 最后一条是 assistant，有 tool_calls 但无 tool 结果', function () {
        it('应该补充缺失的 tool 结果', function () {
            var messages = [
                createMessage({
                    role: 'assistant',
                    content: 'Calling tools',
                    tool_calls: [
                        createToolCall('call_1', 'toolA'),
                        createToolCall('call_2', 'toolB')
                    ],
                    group_id: 'g1',
                    context_id: 'ctx-1'
                })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            // 应该补充2个 tool 结果
            expect(chatManager.messages.length).toBe(3);
            var toolMsgs = chatManager.messages.filter(function (m) { return m.role === 'tool'; });
            expect(toolMsgs.length).toBe(2);
            expect(toolMsgs[0].content).toBe('The user interrupted the task.');
            expect(toolMsgs[0].tool_call_id).toBe('call_1');
            expect(toolMsgs[1].tool_call_id).toBe('call_2');
        });
    });
    describe('场景3: 最后一条是 assistant，有 tool_calls 且有部分 tool 结果', function () {
        it('应该只补充缺失的 tool 结果', function () {
            var messages = [
                createMessage({
                    role: 'assistant',
                    content: 'Calling tools',
                    tool_calls: [
                        createToolCall('call_1', 'toolA'),
                        createToolCall('call_2', 'toolB'),
                        createToolCall('call_3', 'toolC')
                    ],
                    group_id: 'g1',
                    context_id: 'ctx-1'
                }),
                createMessage({
                    role: 'tool',
                    content: 'Result A',
                    tool_call_id: 'call_1',
                    group_id: 'g1',
                    context_id: 'ctx-2'
                })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            // 应该补充2个缺失的 tool 结果
            expect(chatManager.messages.length).toBe(4);
            var toolMsgs = chatManager.messages.filter(function (m) { return m.role === 'tool'; });
            expect(toolMsgs.length).toBe(3);
            expect(toolMsgs[0].tool_call_id).toBe('call_1'); // 原有的
            expect(toolMsgs[1].tool_call_id).toBe('call_2'); // 补充的
            expect(toolMsgs[2].tool_call_id).toBe('call_3'); // 补充的
        });
    });
    describe('场景4: 最后一条是 tool，tool 结果数量少于 tool_calls 数量', function () {
        it('应该补充缺失的 tool 结果', function () {
            var messages = [
                createMessage({
                    role: 'assistant',
                    content: 'Calling tools',
                    tool_calls: [
                        createToolCall('call_1', 'toolA'),
                        createToolCall('call_2', 'toolB'),
                        createToolCall('call_3', 'toolC')
                    ],
                    group_id: 'g1',
                    context_id: 'ctx-1'
                }),
                createMessage({
                    role: 'tool',
                    content: 'Result 1',
                    tool_call_id: 'call_1',
                    group_id: 'g1',
                    context_id: 'ctx-2'
                }),
                createMessage({
                    role: 'tool',
                    content: 'Result 2',
                    tool_call_id: 'call_2',
                    group_id: 'g1',
                    context_id: 'ctx-3'
                })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            // 应该补充1个缺失的 tool 结果
            expect(chatManager.messages.length).toBe(4); // 原有3条 + 补充1条
            var toolMsgs = chatManager.messages.filter(function (m) { return m.role === 'tool'; });
            expect(toolMsgs.length).toBe(3); // 原有2个 + 补充1个
            expect(toolMsgs[2].tool_call_id).toBe('call_3'); // 最后一个补充的
            expect(toolMsgs[3].content).toBe('The user interrupted the task.');
        });
    });
    describe('场景5: 完整的工具调用链（无需修复）', function () {
        it('应该保持消息不变', function () {
            var messages = [
                createMessage({
                    role: 'assistant',
                    content: 'Calling tools',
                    tool_calls: [
                        createToolCall('call_1', 'toolA'),
                        createToolCall('call_2', 'toolB')
                    ],
                    group_id: 'g1',
                    context_id: 'ctx-1'
                }),
                createMessage({
                    role: 'tool',
                    content: 'Result 1',
                    tool_call_id: 'call_1',
                    group_id: 'g1',
                    context_id: 'ctx-2'
                }),
                createMessage({
                    role: 'tool',
                    content: 'Result 2',
                    tool_call_id: 'call_2',
                    group_id: 'g1',
                    context_id: 'ctx-3'
                })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            // 应该保持不变
            expect(chatManager.messages.length).toBe(3);
        });
    });
    describe('场景6: assistant 没有 tool_calls', function () {
        it('应该保持消息不变', function () {
            var messages = [
                createMessage({
                    role: 'user',
                    content: 'Hello'
                }),
                createMessage({
                    role: 'assistant',
                    content: 'Hi there!'
                })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            expect(chatManager.messages.length).toBe(2);
        });
    });
    describe('场景7: 空消息列表', function () {
        it('应该不报错', function () {
            var chatManager = new ChatManager_1.ChatManager([]);
            expect(function () { return chatManager.fixMessages(); }).not.toThrow();
            expect(chatManager.messages.length).toBe(0);
        });
    });
    describe('场景8: 只有 user 消息被删除后的场景', function () {
        it('最后一条是 assistant 且 tool_calls 已完整时应保持不变', function () {
            var messages = [
                createMessage({
                    role: 'user',
                    content: 'First request',
                    group_id: 'g1'
                }),
                createMessage({
                    role: 'assistant',
                    content: 'Response',
                    group_id: 'g1',
                    context_id: 'ctx-2'
                })
            ];
            var chatManager = new ChatManager_1.ChatManager(messages);
            chatManager.fixMessages();
            expect(chatManager.messages.length).toBe(2);
        });
    });
});
