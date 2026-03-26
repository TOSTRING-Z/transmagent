import { main } from './image_vision'; // 请替换为你的实际工具文件路径
import { utils } from '../utils/globals'; // 请替换为你的全局配置路径

// 涉及真实 API 请求和 SSH 连接，将 Jest 超时时间设为 60 秒
jest.setTimeout(60000);

describe('Image Vision Tool Integration Tests', () => {
    const params = {
        api_url: "https://api.gptgod.online/v1/chat/completions",
        api_key: "sk-k1wlz1w32yy00lw54kl4yxjoy2x50nymk1wlz1w32yy00lw5",
        model: "gpt-4o"
    };

    const executeTool = main(params);

    // 备份原始的 getSshConfig 函数
    const originalGetSshConfig = utils.getSshConfig;

    afterEach(() => {
        // 每个测试用例结束后，恢复原始配置，防止污染其他测试
        utils.getSshConfig = originalGetSshConfig;
        jest.restoreAllMocks();
    });

    test('Test 1: Should successfully read LOCAL PNG and get vision result', async () => {
        // Mock 全局配置：强制模拟本地环境（禁用 SSH）
        utils.getSshConfig = jest.fn().mockReturnValue({ enabled: false });

        const result = await executeTool({
            prompt: "请用简短的一句话描述这张图片的核心内容。",
            file_path: "C:\\Users\\tostring\\Pictures\\AgentSCEM.png"
        });

        console.log("🟢 本地 PNG 测试结果:\n", result);

        // 断言：验证返回的是字符串，且没有报错，并包含我们预设的成功前缀
        expect(typeof result).toBe('string');
        expect(result).not.toMatch(/^Error:/); // 确保没有返回 Error 开头的字符串
        expect(result).toContain('【Image Vision Result');
    });

    // test('Test 2: Should attempt to read REMOTE PDF via SSH and call API', async () => {
    //     // Mock 全局配置：强制模拟远程环境（启用 SSH）
    //     // ⚠️ 注意：运行此测试时，如果本机的 WSL 没有开启 SSH 服务，或者密码不对，会返回 SSH Error
    //     utils.getSshConfig = jest.fn().mockReturnValue({
    //         enabled: true,
    //         host: "172.24.65.134",   // 替换为 WSL 的真实 IP 或 localhost
    //         port: 22,
    //         username: "tostring",    // 替换为你的真实用户名
    //         password: "root" // 替换为你的真实密码
    //     });

    //     const result = await executeTool({
    //         prompt: "请总结这个 PDF 文件首屏的视觉信息。",
    //         file_path: "/mnt/c/Users/tostring/Pictures/AgentSCEM.pdf"
    //     });

    //     console.log("🔵 远程 PDF 测试结果:\n", result);

    //     expect(typeof result).toBe('string');

    //     // 这里做了一个条件断言：
    //     // 1. 如果 SSH 连不上，或者 API 拒绝了 PDF 格式，会返回 Error
    //     // 2. 如果一切顺利，会包含 Vision Result
    //     if (result.startsWith('Error')) {
    //         console.warn("⚠️ 收到预期内的错误（可能是 SSH 认证失败，或 API 不支持 PDF base64）:", result);
    //         // 可以进一步断言具体的错误类型，例如：
    //         // expect(result).toMatch(/SSH Connection Error|Unsupported image format/i);
    //     } else {
    //         expect(result).toContain('【Image Vision Result');
    //     }
    // });
});