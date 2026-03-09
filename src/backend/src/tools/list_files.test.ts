import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { main, getPrompt } from './list_files';

// Mock logger 防止测试控制台输出被污染
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

describe('list_files tool', () => {
    let tempDir: string;

    beforeAll(() => {
        // 创建独立运行的临时沙盒目录
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list_files_test_'));

        // 1. 创建普通文件
        fs.writeFileSync(path.join(tempDir, 'index.js'), 'console.log("hello");');
        fs.writeFileSync(path.join(tempDir, 'readme.md'), '# Title');
        
        // 2. 创建应该被过滤的媒体文件
        fs.writeFileSync(path.join(tempDir, 'video.mp4'), 'fake_video');
        fs.writeFileSync(path.join(tempDir, 'icon.png'), 'fake_image');

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
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('1. 非递归扫描模式 (recursive: false)', () => {
        const execute = main({});
        const results = execute({ path: tempDir, recursive: false });

        // 应该返回根目录下的普通文件和文件夹本身（但不进去）
        const baseNames = results.map(r => path.basename(r));
        expect(baseNames).toContain('index.js');
        expect(baseNames).toContain('readme.md');
        expect(baseNames).toContain('src'); // 子目录本身算一项

        // 黑名单项应被剔除
        expect(baseNames).not.toContain('video.mp4');
        expect(baseNames).not.toContain('icon.png');
        expect(baseNames).not.toContain('.vscode');
    });

    it('2. 递归扫描模式 (recursive: true)', () => {
        const execute = main({});
        const results = execute({ path: tempDir, recursive: true });

        const baseNames = results.map(r => path.basename(r));
        
        // 应该包含深层的文件
        expect(baseNames).toContain('utils.ts');
        expect(baseNames).toContain('app.js');
        
        // 黑名单目录内的文件必须彻底隔离
        expect(baseNames).not.toContain('settings.json');
    });

    it('3. 使用正则表达式过滤文件名', () => {
        const execute = main({});
        const results = execute({ 
            path: tempDir, 
            recursive: true, 
            regex: '\\.js$' // 只匹配 .js 结尾的文件
        });

        const baseNames = results.map(r => path.basename(r));
        
        expect(baseNames).toContain('index.js');
        expect(baseNames).toContain('app.js');
        
        // 不满足正则的合法文件也应被排除
        expect(baseNames).not.toContain('utils.ts');
        expect(baseNames).not.toContain('readme.md');
    });

    it('4. 超出 threshold 阈值应返回提示信息', () => {
        // 设置极低的阈值为 1
        const execute = main({ threshold: 1 });
        const results = execute({ path: tempDir, recursive: true });

        expect(results.length).toBe(1);
        expect(results[0]).toBe('Too much content returned, please try another solution!');
    });

    it('5. 遇到无效路径应该返回错误信息包裹', () => {
        const execute = main({});
        const results = execute({ path: path.join(tempDir, 'fake_missing_folder') });

        expect(results.length).toBe(1);
        expect(results[0]).toContain('Path does not exist');
    });

    it('6. getPrompt 应返回说明字符串', () => {
        const prompt = getPrompt();
        expect(typeof prompt).toBe('string');
        expect(prompt).toContain('list_files');
    });
});