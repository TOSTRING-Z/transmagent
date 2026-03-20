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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const screenshot_vision_1 = require("./screenshot_vision");
const child_process_1 = require("child_process");
const axios_1 = __importDefault(require("axios"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
// --- Mocks ---
jest.mock('child_process', () => ({
    execSync: jest.fn()
}));
jest.mock('axios');
jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    unlinkSync: jest.fn()
}));
// 【核心修复】：在顶层直接 Mock os 模块，完美避开 ESM 命名空间不可变的问题
jest.mock('os', () => ({
    ...jest.requireActual('os'),
    platform: jest.fn()
}));
describe('screenshot_vision tool', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // 默认模拟 axios 请求成功
        axios_1.default.post.mockResolvedValue({
            data: {
                choices: [
                    { message: { content: "This is a mock vision analysis." } }
                ]
            }
        });
    });
    it('1. 如果未提供 prompt，应该返回错误信息', async () => {
        const execute = (0, screenshot_vision_1.main)({ api_key: 'test_key' });
        const result = await execute({ prompt: '' });
        expect(result).toBe("Error: 'prompt' argument is required.");
        expect(child_process_1.execSync).not.toHaveBeenCalled();
    });
    it('2. 如果未提供 api_key，应该返回配置错误', async () => {
        const execute = (0, screenshot_vision_1.main)({ api_key: '' });
        const result = await execute({ prompt: 'Describe this screen' });
        expect(result).toBe("Error: 'api_key' is missing in tool configuration.");
    });
    it('3. 在 Windows 环境下应正确调用 PowerShell 并返回结果', async () => {
        os.platform.mockReturnValue('win32');
        child_process_1.execSync.mockReturnValue(Buffer.from('fake_base64_win32'));
        const execute = (0, screenshot_vision_1.main)({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });
        expect(child_process_1.execSync).toHaveBeenCalledWith(expect.stringContaining('powershell.exe'), expect.any(Object));
        expect(axios_1.default.post).toHaveBeenCalled();
        expect(result).toContain('【Vision Result】');
        expect(result).toContain('This is a mock vision analysis.');
    });
    it('4. 在 macOS (darwin) 环境下应调用 screencapture 并读取临时文件', async () => {
        os.platform.mockReturnValue('darwin');
        fs.readFileSync.mockReturnValue('fake_base64_mac');
        const execute = (0, screenshot_vision_1.main)({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });
        expect(child_process_1.execSync).toHaveBeenCalledWith(expect.stringContaining('screencapture -x'));
        expect(fs.readFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
        expect(axios_1.default.post).toHaveBeenCalled();
        expect(result).toContain('【Vision Result】');
    });
    it('5. 在 Linux 环境下应调用 scrot/gnome-screenshot 并读取临时文件', async () => {
        os.platform.mockReturnValue('linux');
        fs.readFileSync.mockReturnValue('fake_base64_linux');
        const execute = (0, screenshot_vision_1.main)({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });
        expect(child_process_1.execSync).toHaveBeenCalledWith(expect.stringContaining('scrot'));
        expect(fs.readFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
        expect(result).toContain('【Vision Result】');
    });
    it('6. 在不支持的系统下应返回平台错误', async () => {
        os.platform.mockReturnValue('aix'); // AIX OS 不受支持
        const execute = (0, screenshot_vision_1.main)({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });
        expect(result).toContain('Error: Unsupported OS platform for screenshot: aix');
        expect(axios_1.default.post).not.toHaveBeenCalled();
    });
    it('7. 遇到网络 API 错误时应该安全捕获并返回错误详情', async () => {
        os.platform.mockReturnValue('win32');
        child_process_1.execSync.mockReturnValue(Buffer.from('fake_base64'));
        // 模拟 axios 抛出带有 response.data 的错误 (如 401 Unauthorized)
        const mockError = new Error('Request failed with status code 401');
        mockError.response = {
            data: { error: { message: "Invalid API key" } }
        };
        axios_1.default.post.mockRejectedValue(mockError);
        const execute = (0, screenshot_vision_1.main)({ api_key: 'bad_key' });
        const result = await execute({ prompt: 'Test' });
        expect(result).toContain('Error calling Vision API: Request failed with status code 401');
        expect(result).toContain('Invalid API key');
    });
    it('8. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = (0, screenshot_vision_1.getPrompt)();
        expect(prompt.name).toBe('screenshot_vision');
        expect(prompt.parameters.required).toContain('prompt');
    });
});
//# sourceMappingURL=screenshot_vision.test.js.map