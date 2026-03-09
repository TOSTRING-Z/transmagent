import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { main, getPrompt } from './replace_in_file';

describe('replace_in_file Tool', () => {
    const tempDir = os.tmpdir();
    let targetFilePath: string;

    // 每次测试前，创建一个具有初始内容的临时文件
    beforeEach(() => {
        targetFilePath = path.join(tempDir, `test_replace_${Date.now()}.txt`);
        const initialContent = `function hello() {\n  console.log("Hello World");\n}\n\nmodule.exports = hello;`;
        fs.writeFileSync(targetFilePath, initialContent, 'utf8');
    });

    // 每次测试后，清理临时文件
    afterEach(() => {
        if (fs.existsSync(targetFilePath)) {
            fs.unlinkSync(targetFilePath);
        }
    });

    it('1. 应该能够成功替换单个代码块', () => {
        const diff = `
<<<<<<< SEARCH
  console.log("Hello World");
=======
  console.log("Hello TypeScript");
>>>>>>> REPLACE
`;
        const result = main({ file_path: targetFilePath, diff });
        
        expect(result).toBe(`File ${targetFilePath} modified successfully`);
        
        const updatedContent = fs.readFileSync(targetFilePath, 'utf8');
        expect(updatedContent).toContain('console.log("Hello TypeScript");');
        expect(updatedContent).not.toContain('console.log("Hello World");');
    });

    it('2. 应该能够成功替换多个代码块', () => {
        const diff = `
<<<<<<< SEARCH
function hello() {
=======
function greet() {
>>>>>>> REPLACE

<<<<<<< SEARCH
module.exports = hello;
=======
export default greet;
>>>>>>> REPLACE
`;
        const result = main({ file_path: targetFilePath, diff });
        
        expect(result).toBe(`File ${targetFilePath} modified successfully`);
        
        const updatedContent = fs.readFileSync(targetFilePath, 'utf8');
        expect(updatedContent).toContain('function greet() {');
        expect(updatedContent).toContain('export default greet;');
    });

    it('3. 当 SEARCH 块找不到对应内容时，应该返回失败信息', () => {
        const diff = `
<<<<<<< SEARCH
  console.log("This does not exist");
=======
  console.log("Will fail");
>>>>>>> REPLACE
`;
        const result = main({ file_path: targetFilePath, diff });
        
        expect(result).toContain('modification failed');
        expect(result).toContain('Search content not found');
        
        // 文件内容不应发生改变
        const updatedContent = fs.readFileSync(targetFilePath, 'utf8');
        expect(updatedContent).toContain('console.log("Hello World");');
    });

    it('4. 当替换内容与原内容相同时，应提示未发生修改', () => {
        const diff = `
<<<<<<< SEARCH
  console.log("Hello World");
=======
  console.log("Hello World");
>>>>>>> REPLACE
`;
        const result = main({ file_path: targetFilePath, diff });
        
        expect(result).toContain('not modified');
    });

    it('5. 当提供了不符合格式的 diff 时，应返回格式错误', () => {
        const diff = `
<<<<<<< SEARCH
  console.log("Hello World");
  // 缺少 ======= 和 >>>>>>> REPLACE
`;
        const result = main({ file_path: targetFilePath, diff });
        
        expect(result).toContain('modification failed: Invalid diff format');
    });

    it('6. 应该正确返回 getPrompt 的工具定义', () => {
        const prompt = getPrompt();
        expect(prompt.name).toBe('replace_in_file');
        expect(prompt.parameters.required).toContain('file_path');
        expect(prompt.parameters.required).toContain('diff');
    });
});