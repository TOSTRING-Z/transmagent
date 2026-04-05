"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cli_execute_1 = require("./cli_execute");
const fs = __importStar(require("fs"));
const child_process = __importStar(require("child_process"));
const electron_1 = require("electron");
const ssh2_1 = require("ssh2");
const WindowManager_1 = require("../main/windows/WindowManager");
// --- Mocks ---
jest.mock('fs', () => ({
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true)
}));
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));
jest.mock('../utils/globals', () => ({
    utils: {
        getSshConfig: jest.fn().mockReturnValue({ enabled: false }) // 默认本地模式
    }
}));
jest.mock('electron', () => {
    return {
        BrowserWindow: jest.fn().mockImplementation(() => {
            let closeHandler = null;
            return {
                loadFile: jest.fn(),
                show: jest.fn(),
                close: jest.fn(() => {
                    if (closeHandler)
                        closeHandler();
                }),
                minimize: jest.fn(),
                once: jest.fn(),
                on: jest.fn((event, cb) => {
                    if (event === 'closed')
                        closeHandler = cb;
                }),
                isDestroyed: jest.fn().mockReturnValue(false),
                webContents: { send: jest.fn() }
            };
        }),
        ipcMain: {
            on: jest.fn(),
            once: jest.fn(),
            off: jest.fn(),
            removeListener: jest.fn()
        }
    };
});
// Mock child_process
jest.mock('child_process', () => {
    const EventEmitter = require('events');
    return {
        exec: jest.fn().mockImplementation(() => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.stdin = { write: jest.fn(), end: jest.fn() };
            child.kill = jest.fn();
            return child;
        })
    };
});
// Mock SSH2 (模拟真实的异步流生命周期)
jest.mock('ssh2', () => {
    const EventEmitter = require('events');
    return {
        Client: jest.fn().mockImplementation(() => {
            const conn = new EventEmitter();
            conn.connect = jest.fn(() => {
                setTimeout(() => conn.emit('ready'), 1);
            });
            conn.end = jest.fn();
            conn.sftp = jest.fn((cb) => {
                const sftp = {
                    createWriteStream: jest.fn(() => {
                        const stream = new EventEmitter();
                        stream.write = jest.fn();
                        // 修复核心：模拟 Node Stream 在 end() 后异步发出 close
                        stream.end = jest.fn(() => {
                            setTimeout(() => stream.emit('close'), 1);
                        });
                        return stream;
                    })
                };
                setTimeout(() => cb(null, sftp), 1);
            });
            conn.exec = jest.fn((cmd, cb) => {
                const stream = new EventEmitter();
                stream.stderr = new EventEmitter();
                stream.write = jest.fn();
                stream.end = jest.fn();
                stream.close = jest.fn();
                // 挂载以供测试断言和操作
                conn.mockStream = stream;
                setTimeout(() => cb(null, stream), 1);
            });
            return conn;
        })
    };
});
describe('cli_execute tool', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });
    describe('Local Execution', () => {
        it('1. 应该能够成功执行本地 bash 代码并返回结果', async () => {
            WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig.mockReturnValue({ enabled: false });
            const execute = (0, cli_execute_1.main)({});
            const promise = execute({ code: 'echo "Hello Local"' });
            // 获取 mock 的 exec 返回的 child 实例
            const execMock = child_process.exec.mock.results[0].value;
            execMock.stdout.emit('data', 'Hello Local\n');
            execMock.emit('close', 0); // exitCode 0 为成功
            const result = await promise;
            expect(result.success).toBe(true);
            expect(result.output).toBe('Hello Local');
            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(fs.unlinkSync).toHaveBeenCalled();
        });
        it('2. 如果执行超时，应该终止并返回超时前收集到的内容', async () => {
            WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig.mockReturnValue({ enabled: false });
            // 设置一个短超时
            const execute = (0, cli_execute_1.main)({});
            const promise = execute({ code: 'sleep 100', timeout: 100 });
            const execMock = child_process.exec.mock.results[0].value;
            execMock.stdout.emit('data', 'Working...\n');
            // 精准推进时间触发 100 秒的超时
            jest.advanceTimersByTime(100 * 1000);
            const result = await promise;
            expect(result.success).toBe(false);
            expect(result.timeout).toBe(true);
            expect(result.output).toBe('Working...');
            expect(result.message).toContain('timed out after 100 seconds');
        });
    });
    describe('SSH Execution', () => {
        it('3. 当开启 SSH 配置时，应通过 ssh2 模块上传并执行代码', async () => {
            WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig.mockReturnValue({ enabled: true, host: '192.168.1.1' });
            const execute = (0, cli_execute_1.main)({});
            const promise = execute({ code: 'echo "Hello SSH"' });
            // 重点：只快进少量时间（如 50ms），让所有的 setTimeout 初始化回调（connect -> sftp -> writeStream -> exec）走完。
            // 绝对不能用 jest.runAllTimers()，否则会触发业务代码中 60 秒的全局超时导致失败！
            jest.advanceTimersByTime(50);
            // 获取 mock 的 ssh 客户端和 stream
            const connMock = ssh2_1.Client.mock.results[0].value;
            const mockStream = connMock.mockStream;
            // 确保 mockStream 已被成功创建
            expect(mockStream).toBeDefined();
            // 发射数据和进程正常结束事件
            mockStream.emit('data', Buffer.from('Hello SSH\n'));
            mockStream.emit('close', 0, '');
            const result = await promise;
            expect(result.success).toBe(true);
            expect(result.output).toBe('Hello SSH');
            expect(connMock.sftp).toHaveBeenCalled();
        });
    });
    describe('IPC Resource Cleanup', () => {
        it('4. 无论成功失败，结束时都必须清理 IPC 监听器防止内存泄漏', async () => {
            WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig.mockReturnValue({ enabled: false });
            const execute = (0, cli_execute_1.main)({});
            const promise = execute({ code: 'ls' });
            const execMock = child_process.exec.mock.results[0].value;
            execMock.emit('close', 0);
            await promise;
            // 验证是否调用了注销 API
            expect(electron_1.ipcMain.off).toHaveBeenCalledWith('minimize-window', expect.any(Function));
            expect(electron_1.ipcMain.removeListener).toHaveBeenCalledWith('close-window', expect.any(Function));
            expect(electron_1.ipcMain.off).toHaveBeenCalledWith('terminal-input', expect.any(Function));
        });
    });
    describe('Threshold Truncation', () => {
        it('5. 输出过长时应该被截断', async () => {
            WindowManager_1.WindowManager.instance.mainWindow.session().utils.getSshConfig.mockReturnValue({ enabled: false });
            const execute = (0, cli_execute_1.main)({ max_lines: 10, max_chars_per_line: 100 });
            const promise = execute({ code: 'echo' });
            const execMock = child_process.exec.mock.results[0].value;
            // 构造长文本 (注意：将超长行放到最后，以免被 slice 逻辑保留后 10 行时抛弃)
            const multiLines = new Array(20).fill('line').join('\n');
            const longLine = 'A'.repeat(150);
            execMock.stdout.emit('data', multiLines + '\n' + longLine);
            execMock.emit('close', 0);
            const result = await promise;
            // 预期结果：被截断标志 + 长行被截断保留 100 个字符
            expect(result.output).toContain('[truncated because the output is too long');
            expect(result.output).toContain('A'.repeat(100) + '...');
        });
    });
});
//# sourceMappingURL=cli_execute.test.js.map