import * as fs from 'fs';
import { main, getPrompt, VisionParams, ToolArgs } from './image_vision';
import { ToolCall } from '../core/ToolCall';
import * as dotenv from 'dotenv';

// 尝试加载 .env 文件中的环境变量 (如果你有的话)
dotenv.config();

// 移除了 axios, pdfjs-dist, canvas 的 jest.mock，一切走真实逻辑

describe('image_vision 真实文件与真实 API E2E 测试', () => {
    const testPdfPath = '/home/tostring/图片/zgr.pdf';
    let mockToolCall: Partial<ToolCall>;
    let params: VisionParams;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // 【关键配置】必须提供真实的 API KEY，建议从环境变量读取
        const realApiKey = process.env.OPENAI_API_KEY || 'sk-填入你真实的API密钥'; 
        
        params = {
            // 如果你在国内需要走代理，可以修改这里的 api_url，例如 'https://api.chatanywhere.tech/v1/chat/completions'
            api_url: 'https://api.gptgod.online/v1/chat/completions', 
            api_key: realApiKey,
            model: 'gpt-5.4-mini'
        };

        mockToolCall = {
            utils: {
                getSshConfig: jest.fn().mockReturnValue({ enabled: false })
            }
        } as any;
    });

    // 【关键配置】将该测试用例的超时时间延长到 60000 毫秒 (60秒)
    it('应能真实渲染PDF并成功调用 OpenAI Vision API 获取分析', async () => {
        // 验证文件存在
        expect(fs.existsSync(testPdfPath)).toBe(true);
        
        // 如果没有配置真实的 Key，阻止测试运行并给出提示
        if (!params.api_key || params.api_key.startsWith('sk-填入')) {
            throw new Error('测试失败：请配置真实的 OPENAI_API_KEY');
        }

        const executeFunction = main(params);
        
        console.log('开始执行真实转换与 API 请求，请耐心等待 10-20 秒...');
        
        const result = await executeFunction({
            prompt: '请用中文简短描述这个PDF第一页的核心标题和大概内容即可。', // 简短提示词有助于加快 API 返回速度
            file_path: testPdfPath,
            toolCall: mockToolCall as ToolCall
        });

        console.log('\n================ 真实 API 返回结果 ================');
        console.log(result);
        console.log('===================================================\n');

        // 验证返回结果基本格式
        expect(result).toContain('【Vision Result】');
        
        // 确保没有发生系统、网络或渲染错误
        expect(result).not.toContain('System Error:');
        expect(result).not.toContain('Error reading file:');
        expect(result).not.toContain('PDF Render Error:');
        
        // 真实大模型返回的内容长度通常都有几十个字符，以此作为简单的断言依据
        const content = result.replace('【Vision Result】\n', '');
        expect(content.length).toBeGreaterThan(10); 
        
    }, 60000); 
});