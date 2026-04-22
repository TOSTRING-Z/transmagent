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
const image_vision_1 = require("./image_vision");
const dotenv = __importStar(require("dotenv"));
// 尝试加载 .env 文件中的环境变量 (如果你有的话)
dotenv.config();
// 移除了 axios, pdfjs-dist, canvas 的 jest.mock，一切走真实逻辑
describe('image_vision 真实文件与真实 API E2E 测试', () => {
    const testPdfPath = '/home/tostring/图片/zgr.pdf';
    let mockToolCall;
    let params;
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
        };
    });
    // 【关键配置】将该测试用例的超时时间延长到 60000 毫秒 (60秒)
    it('应能真实渲染PDF并成功调用 OpenAI Vision API 获取分析', async () => {
        // 验证文件存在
        expect(fs.existsSync(testPdfPath)).toBe(true);
        // 如果没有配置真实的 Key，阻止测试运行并给出提示
        if (!params.api_key || params.api_key.startsWith('sk-填入')) {
            throw new Error('测试失败：请配置真实的 OPENAI_API_KEY');
        }
        const executeFunction = (0, image_vision_1.main)(params);
        console.log('开始执行真实转换与 API 请求，请耐心等待 10-20 秒...');
        const result = await executeFunction({
            prompt: '请用中文简短描述这个PDF第一页的核心标题和大概内容即可。', // 简短提示词有助于加快 API 返回速度
            file_path: testPdfPath,
            toolCall: mockToolCall
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
//# sourceMappingURL=image_vision.test.js.map