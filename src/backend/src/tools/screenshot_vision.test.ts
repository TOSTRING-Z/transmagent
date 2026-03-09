import { main, getPrompt } from './screenshot_vision';
import { execSync } from 'child_process';
import axios from 'axios';
import * as os from 'os';
import * as fs from 'fs';

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
        (axios.post as jest.Mock).mockResolvedValue({
            data: {
                choices: [
                    { message: { content: "This is a mock vision analysis." } }
                ]
            }
        });
    });

    it('1. 如果未提供 prompt，应该返回错误信息', async () => {
        const execute = main({ api_key: 'test_key' });
        const result = await execute({ prompt: '' });
        
        expect(result).toBe("Error: 'prompt' argument is required.");
        expect(execSync).not.toHaveBeenCalled();
    });

    it('2. 如果未提供 api_key，应该返回配置错误', async () => {
        const execute = main({ api_key: '' });
        const result = await execute({ prompt: 'Describe this screen' });
        
        expect(result).toBe("Error: 'api_key' is missing in tool configuration.");
    });

    it('3. 在 Windows 环境下应正确调用 PowerShell 并返回结果', async () => {
        (os.platform as jest.Mock).mockReturnValue('win32');
        (execSync as jest.Mock).mockReturnValue(Buffer.from('fake_base64_win32'));

        const execute = main({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });

        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('powershell.exe'), expect.any(Object));
        expect(axios.post).toHaveBeenCalled();
        expect(result).toContain('【Vision Result】');
        expect(result).toContain('This is a mock vision analysis.');
    });

    it('4. 在 macOS (darwin) 环境下应调用 screencapture 并读取临时文件', async () => {
        (os.platform as jest.Mock).mockReturnValue('darwin');
        (fs.readFileSync as jest.Mock).mockReturnValue('fake_base64_mac');

        const execute = main({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });

        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('screencapture -x'));
        expect(fs.readFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
        expect(axios.post).toHaveBeenCalled();
        expect(result).toContain('【Vision Result】');
    });

    it('5. 在 Linux 环境下应调用 scrot/gnome-screenshot 并读取临时文件', async () => {
        (os.platform as jest.Mock).mockReturnValue('linux');
        (fs.readFileSync as jest.Mock).mockReturnValue('fake_base64_linux');

        const execute = main({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });

        expect(execSync).toHaveBeenCalledWith(expect.stringContaining('scrot'));
        expect(fs.readFileSync).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalled();
        expect(result).toContain('【Vision Result】');
    });

    it('6. 在不支持的系统下应返回平台错误', async () => {
        (os.platform as jest.Mock).mockReturnValue('aix'); // AIX OS 不受支持

        const execute = main({ api_key: 'test_key' });
        const result = await execute({ prompt: 'Test' });

        expect(result).toContain('Error: Unsupported OS platform for screenshot: aix');
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('7. 遇到网络 API 错误时应该安全捕获并返回错误详情', async () => {
        (os.platform as jest.Mock).mockReturnValue('win32');
        (execSync as jest.Mock).mockReturnValue(Buffer.from('fake_base64'));

        // 模拟 axios 抛出带有 response.data 的错误 (如 401 Unauthorized)
        const mockError = new Error('Request failed with status code 401');
        (mockError as any).response = {
            data: { error: { message: "Invalid API key" } }
        };
        (axios.post as jest.Mock).mockRejectedValue(mockError);

        const execute = main({ api_key: 'bad_key' });
        const result = await execute({ prompt: 'Test' });

        expect(result).toContain('Error calling Vision API: Request failed with status code 401');
        expect(result).toContain('Invalid API key');
    });

    it('8. getPrompt 应该返回正确的工具定义 Schema', () => {
        const prompt = getPrompt();
        expect(prompt.name).toBe('screenshot_vision');
        expect(prompt.parameters.required).toContain('prompt');
    });
});