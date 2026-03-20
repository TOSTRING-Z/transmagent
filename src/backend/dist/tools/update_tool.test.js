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
const update_tool_1 = require("./update_tool");
const globals_1 = require("../utils/globals");
// 模拟 logger
jest.mock('../utils/logger', () => ({
    logger: {
        log: jest.fn(),
        error: jest.fn()
    }
}));
// 模拟 utils，拦截 getConfig 将目标文件指向我们的临时文件
jest.mock('../utils/globals', () => ({
    utils: {
        getConfig: jest.fn(),
        getDefault: jest.fn()
    }
}));
describe('update_tool tool', () => {
    let tempPromptFile;
    beforeEach(() => {
        jest.clearAllMocks();
        // 每次测试前创建一个全新的临时文件
        tempPromptFile = path.join(os.tmpdir(), `cli_prompt_test_${Date.now()}_${Math.floor(Math.random() * 1000)}.md`);
        // 初始化一些模拟的工具文档内容
        const initialContent = `
***

Standard File Structure:
All new tools must be installed under the \`/data/auto_installed_tools/\` root directory and strictly adhere to the following structure:

* Root Directory: \`/data/auto_installed_tools/<Tool_Name>/\`
  * 📄 \`install.md\`: Detailed installation process record
  * 📄 \`usage.md\`: Tool usage manual
  * 📄 \`environment.md\`: Dependency and environment configuration details
  * 📂 \`script/\`: Stores main script files
  * 📂 \`dependency/\`: Stores dependency files
  * 📂 \`test/\`: Stores test scripts or test data
  * 📂 \`example/\`: Stores example files
  
***

- search_files: A tool to search files
  - input: query

- legacy-tool: An old tool
  - param: test

- last_tool: The final tool in the list
  - use: test
***
`;
        fs.writeFileSync(tempPromptFile, initialContent.trim(), 'utf8');
        // 让工具读取我们创建的临时文件
        globals_1.utils.getConfig.mockReturnValue({ cli_prompt: tempPromptFile });
    });
    afterEach(() => {
        // 清理临时文件
        if (fs.existsSync(tempPromptFile)) {
            fs.unlinkSync(tempPromptFile);
        }
    });
    it('1. 当工具不存在时，应该追加到文件末尾', async () => {
        const newToolDoc = `- new_tool: This is a new tool\n  - param: test`;
        const result = await (0, update_tool_1.main)()({
            tool_name: 'new_tool',
            tool_documentation: newToolDoc
        });
        expect(result.success).toBe(true);
        expect(result.action).toBe('added');
        const fileContent = fs.readFileSync(tempPromptFile, 'utf8');
        expect(fileContent).toContain(newToolDoc);
        // 断言它被追加到了末尾，并且换行格式正确
        expect(fileContent.endsWith(newToolDoc)).toBe(true);
    });
    it('2. 应该能够成功更新位于中间位置的工具内容', async () => {
        const updatedDoc = `- legacy-tool: Updated legacy tool description\n  - param: updated`;
        const result = await (0, update_tool_1.main)()({
            tool_name: 'legacy-tool',
            tool_documentation: updatedDoc
        });
        expect(result.success).toBe(true);
        expect(result.action).toBe('updated');
        const fileContent = fs.readFileSync(tempPromptFile, 'utf8');
        // 原内容应该被彻底抹除
        expect(fileContent).not.toContain('An old tool');
        // 新内容必须存在
        expect(fileContent).toContain(updatedDoc);
        // 其他工具不应该受影响
        expect(fileContent).toContain('- search_files:');
        expect(fileContent).toContain('- last_tool:');
    });
    it('3. 应该能够成功更新位于末尾边界位置的工具内容', async () => {
        const updatedDoc = `- last_tool: Updated final tool\n  - use: updated test`;
        const result = await (0, update_tool_1.main)()({
            tool_name: 'last_tool',
            tool_documentation: updatedDoc
        });
        expect(result.success).toBe(true);
        expect(result.action).toBe('updated');
        const fileContent = fs.readFileSync(tempPromptFile, 'utf8');
        expect(fileContent).toContain(updatedDoc);
        expect(fileContent).not.toContain('The final tool in the list');
        // 测试结尾的 *** 标志是否被正确保留（或根据逻辑处于新工具之后）
        expect(fileContent).toContain('***');
    });
    it('4. 如果缺失必填参数，应该抛出明确错误', async () => {
        const result = await (0, update_tool_1.main)()({
            tool_name: '', // 缺失名字
            tool_documentation: '- missing: test'
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Both tool_name and tool_documentation parameters are required');
    });
    it('5. 如果文件完全不存在，应该自动初始化空文件并成功追加', async () => {
        // 先删除临时文件
        fs.unlinkSync(tempPromptFile);
        const newToolDoc = `- init_tool: create from scratch`;
        const result = await (0, update_tool_1.main)()({
            tool_name: 'init_tool',
            tool_documentation: newToolDoc
        });
        expect(result.success).toBe(true);
        const fileContent = fs.readFileSync(tempPromptFile, 'utf8');
        expect(fileContent).toBe(newToolDoc);
    });
    it('6. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = (0, update_tool_1.getPrompt)();
        expect(prompt.name).toBe('update_tool');
        expect(prompt.parameters.required).toContain('tool_name');
        expect(prompt.parameters.required).toContain('tool_documentation');
    });
});
//# sourceMappingURL=update_tool.test.js.map