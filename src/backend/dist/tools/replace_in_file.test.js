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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const replace_in_file_1 = require("./replace_in_file");
describe('replace_in_file Tool', () => {
    const tempDir = os.tmpdir();
    let targetFilePath;
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
    it('1. 应该能够成功替换单个代码块', async () => {
        const diff = `
<<<<<<< SEARCH
  console.log("Hello World");
=======
  console.log("Hello TypeScript");
>>>>>>> REPLACE
`;
        const result = await (0, replace_in_file_1.main)()({ file_path: targetFilePath, diff });
        expect(result).toBe(`File ${targetFilePath} modified successfully`);
        const updatedContent = fs.readFileSync(targetFilePath, 'utf8');
        expect(updatedContent).toContain('console.log("Hello TypeScript");');
        expect(updatedContent).not.toContain('console.log("Hello World");');
    });
    it('2. 应该能够成功替换多个代码块', async () => {
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
        const result = await (0, replace_in_file_1.main)()({ file_path: targetFilePath, diff });
        expect(result).toBe(`File ${targetFilePath} modified successfully`);
        const updatedContent = fs.readFileSync(targetFilePath, 'utf8');
        expect(updatedContent).toContain('function greet() {');
        expect(updatedContent).toContain('export default greet;');
    });
    it('3. 当 SEARCH 块找不到对应内容时，应该返回失败信息', async () => {
        const diff = `
<<<<<<< SEARCH
  console.log("This does not exist");
=======
  console.log("Will fail");
>>>>>>> REPLACE
`;
        const result = await (0, replace_in_file_1.main)()({ file_path: targetFilePath, diff });
        expect(result).toContain('modification failed');
        expect(result).toContain('Search content not found');
        // 文件内容不应发生改变
        const updatedContent = fs.readFileSync(targetFilePath, 'utf8');
        expect(updatedContent).toContain('console.log("Hello World");');
    });
    it('4. 当替换内容与原内容相同时，应提示未发生修改', async () => {
        const diff = `
<<<<<<< SEARCH
  console.log("Hello World");
=======
  console.log("Hello World");
>>>>>>> REPLACE
`;
        const result = await (0, replace_in_file_1.main)()({ file_path: targetFilePath, diff });
        expect(result).toContain('not modified');
    });
    it('5. 当提供了不符合格式的 diff 时，应返回格式错误', async () => {
        const diff = `
<<<<<<< SEARCH
  console.log("Hello World");
  // 缺少 ======= 和 >>>>>>> REPLACE
`;
        const result = await (0, replace_in_file_1.main)()({ file_path: targetFilePath, diff });
        expect(result).toContain('Search content not found');
    });
    it('6. 应该正确返回 getPrompt 的工具定义', () => {
        const prompt = (0, replace_in_file_1.getPrompt)();
        expect(prompt.name).toBe('replace_in_file');
        expect(prompt.parameters.required).toContain('file_path');
        expect(prompt.parameters.required).toContain('diff');
    });
});
//# sourceMappingURL=replace_in_file.test.js.map