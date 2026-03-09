import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { main, getPrompt } from './write_to_file';

describe('write_to_file tool', () => {
    let tempDir: string;

    beforeEach(() => {
        // 每次测试前创建一个全新的临时沙盒目录
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write_to_file_test_'));
    });

    afterEach(() => {
        // 清理临时目录及其中的所有文件
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('1. 应该能够成功向已存在的目录写入文件', async () => {
        const filePath = path.join(tempDir, 'test.txt');
        const content = 'Hello, TypeScript!';

        const result = await main({ file_path: filePath, content });

        // 断言返回结果
        expect(result).toBe(`File ${filePath} saved successfully`);
        
        // 断言文件确实被写入，且内容正确
        const savedContent = fs.readFileSync(filePath, 'utf8');
        expect(savedContent).toBe(content);
    });

    it('2. 当父级目录不存在时，应该自动递归创建目录并写入', async () => {
        // 构造一个多层级的不存在的目录结构
        const deepFilePath = path.join(tempDir, 'deep', 'nested', 'folder', 'test.ts');
        const content = 'console.log("Deep Folder");';

        const result = await main({ file_path: deepFilePath, content });

        expect(result).toBe(`File ${deepFilePath} saved successfully`);
        
        // 断言深层文件已成功写入
        const savedContent = fs.readFileSync(deepFilePath, 'utf8');
        expect(savedContent).toBe(content);
    });

    it('3. 当没有提供 content 时，应该默认写入空字符串', async () => {
        const filePath = path.join(tempDir, 'empty.txt');

        const result = await main({ file_path: filePath });

        expect(result).toBe(`File ${filePath} saved successfully`);
        
        const savedContent = fs.readFileSync(filePath, 'utf8');
        expect(savedContent).toBe(''); // 默认值应为空字符串
    });

    it('4. 如果缺失必填的 file_path 参数，应该返回失败信息', async () => {
        const result = await main({ file_path: '' }); // 模拟传入空路径

        expect(result).toContain('save failed');
        expect(result).toContain('file_path is required');
    });

    it('5. 遇到系统级写入错误时应捕获并返回错误信息', async () => {
        // 模拟一个非法路径 (例如向一个已被当作目录的路径写入文件)
        const invalidFilePath = path.join(tempDir, 'is_a_dir');
        fs.mkdirSync(invalidFilePath); // 先创建一个同名目录

        const result = await main({ file_path: invalidFilePath, content: 'test' });

        expect(result).toContain('save failed');
        // 验证错误信息包含文件系统抛出的错误 (EISDIR: illegal operation on a directory)
        expect(result).toContain('EISDIR'); 
    });

    it('6. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = getPrompt();
        expect(prompt.name).toBe('write_to_file');
        expect(prompt.parameters.required).toContain('file_path');
        expect(prompt.parameters.properties).toHaveProperty('content');
    });
});