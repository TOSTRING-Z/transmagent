import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { main, getPrompt, SearchResult } from './search_files';

// Mock logger 避免污染测试输出
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

describe('search_files tool', () => {
    let tempDir: string;

    // 每次执行整个测试套件前，创建一个专属的临时目录
    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search_files_test_'));
        
        // 1. 创建普通文本文件 (匹配白名单)
        const jsFilePath = path.join(tempDir, 'script.js');
        fs.writeFileSync(jsFilePath, 'const x = 10;\nfunction test() {\n  return "Hello World";\n}\n');

        // 2. 创建一个深层目录的文本文件
        const subDir = path.join(tempDir, 'src');
        fs.mkdirSync(subDir);
        const mdFilePath = path.join(subDir, 'readme.md');
        fs.writeFileSync(mdFilePath, '# Title\nThis is a test document.\nEnd of file.');

        // 3. 创建带有黑名单后缀的二进制伪造文件
        const imgFilePath = path.join(tempDir, 'image.png');
        fs.writeFileSync(imgFilePath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

        // 4. 创建无后缀的未知文件（但内容包含 Null 字节，模拟二进制文件）
        const unknownBinaryPath = path.join(tempDir, 'unknown_blob');
        const binaryBuffer = Buffer.alloc(50);
        binaryBuffer.write('Some text...', 0);
        binaryBuffer[20] = 0; // 注入 null 字节
        fs.writeFileSync(unknownBinaryPath, binaryBuffer);
    });

    // 运行结束后清理临时目录
    afterAll(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('1. 应该能够成功匹配文本文件中的关键字并返回正确的行号与上下文', async () => {
        const result = await main({
            path: tempDir,
            regex: 'Hello World', // 【修复】：使用具体关键字，而不是 .+
            file_pattern: '**/*'
        });

        // 断言返回结果不是错误字符串
        expect(Array.isArray(result)).toBe(true);
        const matches = result as SearchResult[];
        
        // 现在这里应该是 1 了
        expect(matches.length).toBe(1);
        expect(matches[0].file).toBe('script.js');
        expect(matches[0].match).toBe('Hello World');
        expect(matches[0].line).toBe(3);
        expect(matches[0].context).toContain('return "Hello World";');
    });

    it('2. 应该能够使用递归 glob pattern 搜索子目录', async () => {
        const result = await main({
            path: tempDir,
            regex: 'test document',
            file_pattern: '**/*.md'
        });

        expect(Array.isArray(result)).toBe(true);
        const matches = result as SearchResult[];
        
        expect(matches.length).toBe(1);
        expect(matches[0].file).toBe(path.join('src', 'readme.md'));
        expect(matches[0].line).toBe(2);
    });

    it('3. 应该智能过滤黑名单扩展名和包含 Null 字节的二进制文件', async () => {
        // 搜索所有的文件，不限制 file_pattern
        const result = await main({
            path: tempDir,
            regex: '.*', // 匹配所有非空字符
            file_pattern: '**/*'
        });

        expect(Array.isArray(result)).toBe(true);
        const matches = result as SearchResult[];
        
        const matchedFiles = matches.map(m => m.file);
        
        // 必须能搜到文本文件
        expect(matchedFiles).toContain('script.js');
        expect(matchedFiles).toContain(path.join('src', 'readme.md'));
        
        // 绝对不能搜到二进制图片或伪造的 blob 文件
        expect(matchedFiles).not.toContain('image.png');
        expect(matchedFiles).not.toContain('unknown_blob');
    });

    it('4. 如果没有找到匹配的文件，应该返回明确的错误提示', async () => {
        const result = await main({
            path: tempDir,
            regex: 'test',
            file_pattern: '**/*.python' // 不存在此类文件
        });

        // 根据原本的设计，遇到异常返回 error.message 字符串
        expect(typeof result).toBe('string');
        expect(result).toBe('No files found matching the pattern');
    });

    it('5. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = getPrompt();
        expect(prompt.name).toBe('search_files');
        expect(prompt.parameters.required).toContain('path');
        expect(prompt.parameters.required).toContain('regex');
    });
});