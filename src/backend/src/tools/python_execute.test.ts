import { main, getPrompt } from './python_execute';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { ipcMain, BrowserWindow } from 'electron';

// --- Mock 依赖 ---
jest.mock('fs', () => ({
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true)
}));

jest.mock('../utils/logger', () => ({
    logger: { log: jest.fn() }
}));

// Mock Electron 模块
jest.mock('electron', () => {
    const mockWebContents = {
        send: jest.fn()
    };
    
    return {
        BrowserWindow: jest.fn().mockImplementation(() => {
            let closeHandler: Function | null = null;
            return {
                loadFile: jest.fn(),
                show: jest.fn(),
                close: jest.fn(() => {
                    if (closeHandler) closeHandler();
                }),
                minimize: jest.fn(),
                once: jest.fn((event, cb) => {
                    if (event === 'ready-to-show') cb();
                }),
                on: jest.fn((event, cb) => {
                    if (event === 'closed') closeHandler = cb;
                }),
                isDestroyed: jest.fn().mockReturnValue(false),
                webContents: mockWebContents
            };
        }),
        ipcMain: {
            on: jest.fn(),
            off: jest.fn()
        }
    };
});

// Mock child_process.spawn
jest.mock('child_process', () => {
    const EventEmitter = require('events');
    return {
        spawn: jest.fn().mockImplementation(() => {
            const child: any = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stdout.setEncoding = jest.fn();
            child.stderr = new EventEmitter();
            child.stderr.setEncoding = jest.fn();
            child.stdin = {
                write: jest.fn(),
                end: jest.fn()
            };
            child.kill = jest.fn();
            return child;
        })
    };
});

describe('python_execute tool', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('1. 应该能够成功执行 Python 代码并返回结果', async () => {
        const execute = main({ python_bin: 'python3', delay_time: 0 });
        
        // 启动执行
        const promise = execute({ code: 'print("Hello World")' });
        
        // 获取 Mock 的 spawn 实例
        const spawnMock = (child_process.spawn as jest.Mock).mock.results[0].value;
        
        // 模拟输出数据和退出事件
        spawnMock.stdout.emit('data', 'Hello World\n');
        spawnMock.emit('close', 0);
        
        // 推进定时器 (处理 setTimeout)
        jest.runAllTimers();
        
        const resultStr = await promise;
        const result = JSON.parse(resultStr);
        
        expect(result.success).toBe(true);
        expect(result.output).toBe('Hello World\n');
        expect(result.error).toBe('');
        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('2. 应该能处理执行错误 (stderr)', async () => {
        const execute = main({ python_bin: 'python3', delay_time: 0 });
        const promise = execute({ code: '1 / 0' });
        
        const spawnMock = (child_process.spawn as jest.Mock).mock.results[0].value;
        spawnMock.stderr.emit('data', 'ZeroDivisionError');
        spawnMock.emit('close', 1); // 异常退出码
        
        jest.runAllTimers();
        const resultStr = await promise;
        const result = JSON.parse(resultStr);
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('ZeroDivisionError');
    });

    it('3. 当输出超过 threshold 时，应该截断并提示', async () => {
        const execute = main({ python_bin: 'python3', threshold: 10, delay_time: 0 });
        const promise = execute({ code: 'print("This is a very long string")' });
        
        const spawnMock = (child_process.spawn as jest.Mock).mock.results[0].value;
        spawnMock.stdout.emit('data', 'This is a very long string that exceeds 10 chars');
        spawnMock.emit('close', 0);
        
        jest.runAllTimers();
        const resultStr = await promise;
        const result = JSON.parse(resultStr);
        
        expect(result.output).toBe('Returned content is too large, please try another solution!');
    });

    it('4. 进程结束时应该正确清理所有的 ipcMain 监听器', async () => {
        const execute = main({ python_bin: 'python3', delay_time: 0 });
        const promise = execute({ code: 'pass' });
        
        const spawnMock = (child_process.spawn as jest.Mock).mock.results[0].value;
        spawnMock.emit('close', 0);
        
        jest.runAllTimers();
        await promise;
        
        // 验证注册和解绑的监听器数量是否完全对等
        expect(ipcMain.on).toHaveBeenCalledTimes(4);
        expect(ipcMain.off).toHaveBeenCalledTimes(4);
        
        // 验证关键的事件确实被注销了
        expect(ipcMain.off).toHaveBeenCalledWith('minimize-window', expect.any(Function));
        expect(ipcMain.off).toHaveBeenCalledWith('close-window', expect.any(Function));
    });

    it('5. getPrompt 应该返回正确的工具定义', () => {
        const prompt = getPrompt();
        expect(prompt.name).toBe('python_execute');
        expect(prompt.parameters.required).toContain('code');
    });
});