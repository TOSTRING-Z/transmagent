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
const display_file_1 = require("./display_file");
// 模拟外部依赖，避免测试报错
jest.mock('../utils/logger', () => ({
    logger: { log: jest.fn(), error: jest.fn() }
}), { virtual: true });
jest.mock('../utils/globals', () => ({
    utils: { getSshConfig: jest.fn(() => ({ enabled: false })) }
}), { virtual: true });
jest.mock('../main/windows/WindowManager', () => ({
    WindowManager: { instance: null }
}), { virtual: true });
describe('DisplayFile Tool', () => {
    const tempDir = os.tmpdir();
    let runner;
    beforeAll(() => {
        runner = (0, display_file_1.main)({ local_path: tempDir });
    });
    describe('Text File Processing', () => {
        const textFilePath = path.join(tempDir, 'test_text.txt');
        beforeAll(() => {
            fs.writeFileSync(textFilePath, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
        });
        afterAll(() => {
            if (fs.existsSync(textFilePath))
                fs.unlinkSync(textFilePath);
        });
        it('should correctly parse text file within range', async () => {
            const result = await runner({
                file_path: textFilePath,
                start_line: 2,
                end_line: 4,
                file_type: 'text'
            });
            expect(result).toContain('Line 2');
            expect(result).toContain('Line 4');
            expect(result).not.toContain('Line 1');
            expect(result).not.toContain('Line 5');
            expect(result).toContain('```text'); // 包含代码块包裹
        });
        it('should truncate lines exceeding max_line_length', async () => {
            const result = await runner({
                file_path: textFilePath,
                start_line: 1,
                end_line: 2,
                max_line_length: 4, // 限制每行为4个字符
                file_type: 'text'
            });
            expect(result).toContain('Line ...[truncated]');
        });
    });
    describe('CSV File Processing', () => {
        const csvFilePath = path.join(tempDir, 'test_data.csv');
        beforeAll(() => {
            const csvContent = 'ID,Name,Department,Status\n1,Alice,Engineering,Active\n2,Bob,"Sales, NA",Inactive\n3,Charlie,HR,Active';
            fs.writeFileSync(csvFilePath, csvContent);
        });
        afterAll(() => {
            if (fs.existsSync(csvFilePath))
                fs.unlinkSync(csvFilePath);
        });
        it('should format CSV as markdown table correctly', async () => {
            const result = await runner({
                file_path: csvFilePath,
                start_line: 1,
                end_line: 10,
                file_type: 'table'
            });
            expect(result).toContain('| ID | Name | Department | Status |');
            expect(result).toContain('| --- | --- | --- | --- |');
            expect(result).toContain('| 1 | Alice | Engineering | Active |');
            expect(result).toContain('| 2 | Bob | Sales, NA | Inactive |'); // 验证带逗号的引号是否被正确处理
        });
        it('should truncate columns if exceeding max_cols', async () => {
            const result = await runner({
                file_path: csvFilePath,
                start_line: 1,
                end_line: 10,
                max_cols: 2, // 限制为两列
                file_type: 'table'
            });
            expect(result).toContain('| ID | Name |');
            expect(result).not.toContain('Department');
            expect(result).toContain('Column output truncated');
        });
    });
    describe('Image/Media File Processing', () => {
        const imagePath = path.join(tempDir, 'test_image.png');
        beforeAll(() => {
            fs.writeFileSync(imagePath, 'dummy buffer'); // 创建一个空假文件
        });
        afterAll(() => {
            if (fs.existsSync(imagePath))
                fs.unlinkSync(imagePath);
        });
        it('should return markdown image format', async () => {
            const result = await runner({
                file_path: imagePath,
                file_type: 'auto'
            });
            expect(result).toContain(`![test_image.png](${imagePath})`);
            expect(result).toContain('**Local File**:'); // 验证页脚
        });
    });
    describe('Error Handling', () => {
        it('should return error string if file does not exist', async () => {
            const result = await runner({
                file_path: path.join(tempDir, 'does_not_exist.txt')
            });
            expect(result).toContain('Error: File not found');
        });
    });
});
//# sourceMappingURL=display_file.test.js.map