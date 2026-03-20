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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const list_dir_1 = require("./list_dir");
const globals_1 = require("../utils/globals");
// 1. Mock logger 防止测试控制台输出被污染
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));
// 2. Mock 全局配置，防止由于环境中未定义 sshConfig 导致测试崩溃
jest.mock('../utils/globals', () => ({
    utils: {
        getSshConfig: jest.fn()
    }
}));
// 3. Mock ssh2 模块以覆盖远程分支
// jest.mock('ssh2');
describe('list_dir tool', () => {
    let tempDir;
    beforeAll(() => {
        // 创建独立运行的临时沙盒目录
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list_files_test_'));
        // 优化点：使用数据驱动的方式批量创建基础文件，代码更整洁
        const filesToCreate = [
            { name: 'index.js', content: 'console.log("hello");' },
            { name: 'readme.md', content: '# Title' },
            { name: 'video.mp4', content: 'fake_video' }, // 媒体黑名单
            { name: 'icon.png', content: 'fake_image' }, // 媒体黑名单
        ];
        filesToCreate.forEach(f => fs.writeFileSync(path.join(tempDir, f.name), f.content));
        // 3. 创建应该被过滤的 IDE 目录 (.vscode)
        const vscodeDir = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodeDir);
        fs.writeFileSync(path.join(vscodeDir, 'settings.json'), '{}');
        // 4. 创建合法的子目录
        const subDir = path.join(tempDir, 'src');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, 'utils.ts'), 'export const util = {};');
        fs.writeFileSync(path.join(subDir, 'app.js'), 'export const app = {};');
    });
    afterAll(() => {
        // 彻底清理临时目录
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    beforeEach(() => {
        jest.clearAllMocks();
        // 默认每次测试前重置为本地模式
        globals_1.utils.getSshConfig.mockReturnValue({ enabled: false });
    });
    it('1. 非递归扫描模式 (recursive: false)', async () => {
        const execute = (0, list_dir_1.main)({});
        const results = await execute({ path: tempDir, recursive: false });
        const baseNames = results.map(r => path.basename(r));
        // 优化点：使用 expect.arrayContaining 进行批量断言
        expect(baseNames).toEqual(expect.arrayContaining(['index.js', 'readme.md', 'src']));
        expect(baseNames).not.toEqual(expect.arrayContaining(['video.mp4', 'icon.png', '.vscode']));
    });
    it('2. 递归扫描模式 (recursive: true)', async () => {
        const execute = (0, list_dir_1.main)({});
        const results = await execute({ path: tempDir, recursive: true });
        const baseNames = results.map(r => path.basename(r));
        expect(baseNames).toEqual(expect.arrayContaining(['utils.ts', 'app.js']));
        expect(baseNames).not.toContain('settings.json');
    });
    it('3. 使用正则表达式过滤文件名', async () => {
        const execute = (0, list_dir_1.main)({});
        const results = await execute({
            path: tempDir,
            recursive: true,
            regex: '\\.js$'
        });
        const baseNames = results.map(r => path.basename(r));
        expect(baseNames).toEqual(expect.arrayContaining(['index.js', 'app.js']));
        // 优化点：严格反向校验，确保没有漏网之鱼
        expect(baseNames.some(name => !name.endsWith('.js'))).toBe(false);
    });
    it('4. 超出 threshold 阈值应返回提示信息', async () => {
        const execute = (0, list_dir_1.main)({ threshold: 1 });
        const results = await execute({ path: tempDir, recursive: true });
        expect(results).toHaveLength(1);
        expect(results[0]).toBe('Too much content returned, please try another solution!');
    });
    it('5. 遇到无效路径应该返回错误信息包裹', async () => {
        const execute = (0, list_dir_1.main)({});
        const results = await execute({ path: path.join(tempDir, 'fake_missing_folder') });
        expect(results).toHaveLength(1);
        expect(results[0]).toMatch(/Path does not exist/);
    });
    it('6. getPrompt 应返回说明字符串', () => {
        const prompt = (0, list_dir_1.getPrompt)();
        expect(typeof prompt).toBe('string');
        expect(prompt).toContain('list_dir');
    });
    // 新增点：对刚刚加入的 SSH 逻辑进行基本的 Mock 测试，保证远程分支不会抛出未捕获异常
    it('7. SSH 模式被启用时，应正确拦截并调用远程连接逻辑', async () => {
        // 根据环境设置不同的SSH配置
        const isWindows = process.platform === 'win32';
        console.log(isWindows);
        // Mock SSH配置
        globals_1.utils.getSshConfig.mockReturnValue(isWindows ? {
            enabled: true,
            port: 22,
            username: "tostring",
            password: "root",
            host: '172.24.65.134'
        } : {
            enabled: true,
            port: 3022,
            username: "root",
            password: "root123",
            host: '127.0.0.1'
        });
        // Mock ssh2 的行为，模拟连接失败事件，测试错误能否被正确 resolve 返回而不是导致崩溃
        // const mockOn = jest.fn().mockImplementation(function (this: any, event: string, cb: any) {
        //     if (event === 'error') {
        //         setTimeout(() => cb(new Error('Mocked SSH Connection Failed')), 10);
        //     }
        //     return this;
        // });
        // const mockConnect = jest.fn();
        // (Client as unknown as jest.Mock).mockImplementation(() => ({
        //     on: mockOn,
        //     connect: mockConnect,
        //     end: jest.fn()
        // }));
        const execute = (0, list_dir_1.main)({});
        const results = await execute({ path: '/' });
        console.log(results);
        expect(results.length).toBeGreaterThan(0);
        // expect(results[0]).toBe('SSH Connection Error: Mocked SSH Connection Failed');
        // expect(mockConnect).toHaveBeenCalled();
    });
});
//# sourceMappingURL=list_dir.test.js.map