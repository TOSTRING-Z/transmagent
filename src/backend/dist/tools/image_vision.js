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
exports.main = main;
exports.getPrompt = getPrompt;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const ssh2_1 = require("ssh2");
const puppeteer_1 = __importDefault(require("puppeteer"));
const logger_1 = require("../utils/logger");
const globals_1 = require("../utils/globals");
function main(params) {
    return async (args) => {
        try {
            const { prompt, file_path } = args;
            if (!prompt)
                return "Error: 'prompt' argument is required.";
            if (!file_path)
                return "Error: 'file_path' argument is required.";
            const apiUrl = params.api_url || "https://api.openai.com/v1/chat/completions";
            const apiKey = params.api_key;
            const model = params.model || "gpt-4o";
            if (!apiKey)
                return "Error: 'api_key' is missing in tool configuration.";
            const sshConfig = globals_1.utils.getSshConfig ? globals_1.utils.getSshConfig() : null;
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
            let fileBuffer;
            const ext = path.extname(file_path).toLowerCase();
            // ==========================================
            // 1. 读取文件到 Buffer (兼容本地/远程)
            // ==========================================
            try {
                if (isRemote) {
                    logger_1.logger.info(`Reading remote file via SFTP: ${file_path}`);
                    fileBuffer = await new Promise((resolve, reject) => {
                        const conn = new ssh2_1.Client();
                        const cleanup = () => { if (conn)
                            conn.end(); };
                        conn.on('ready', () => {
                            conn.sftp((err, sftp) => {
                                if (err) {
                                    cleanup();
                                    return reject(err);
                                }
                                const targetPath = file_path.replace(/\\/g, '/');
                                sftp.readFile(targetPath, (readErr, data) => {
                                    cleanup();
                                    if (readErr)
                                        reject(readErr);
                                    else
                                        resolve(data);
                                });
                            });
                        }).on('error', (err) => {
                            cleanup();
                            reject(err);
                        }).connect({ ...sshConfig, readyTimeout: 20000 });
                    });
                }
                else {
                    logger_1.logger.info(`Reading local file: ${file_path}`);
                    if (!fs.existsSync(file_path)) {
                        return `Error: File not found at path: ${file_path}`;
                    }
                    fileBuffer = await fs.promises.readFile(file_path);
                }
            }
            catch (err) {
                return `Error: Failed to read file ${file_path}. Details: ${err.message}`;
            }
            if (!fileBuffer || fileBuffer.length === 0)
                return "Error: File is empty.";
            let finalPngBase64 = "";
            // ==========================================
            // 2. 核心：基于 Puppeteer 的万物截图转换
            // ==========================================
            // 如果是常规标准图片，直接转 Base64 节省性能
            if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
                logger_1.logger.info(`Native image format detected. Skipping browser rendering.`);
                finalPngBase64 = fileBuffer.toString('base64');
            }
            else {
                // 如果是 PDF, SVG, HTML 等需要渲染的文件，启动浏览器
                logger_1.logger.info(`Complex format (${ext}) detected. Launching Headless Browser...`);
                let browser;
                let tempFilePath = "";
                try {
                    // 将 Buffer 写入系统的临时目录，供浏览器读取
                    tempFilePath = path.join(os.tmpdir(), `vision_temp_${Date.now()}${ext}`);
                    await fs.promises.writeFile(tempFilePath, fileBuffer);
                    browser = await puppeteer_1.default.launch({
                        headless: true, // 使用无头模式
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
                    });
                    const page = await browser.newPage();
                    // 设置一个高清的视口，保证大模型能看清细节
                    await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 2 });
                    // 导航到临时文件（Chrome 会调用自带的优质 PDF 查看器或 SVG 引擎）
                    logger_1.logger.info(`Browser navigating to file...`);
                    const fileUrl = `file://${tempFilePath.replace(/\\/g, '/')}`;
                    await page.goto(fileUrl, { waitUntil: 'networkidle2' });
                    // 如果是 PDF，稍等片刻确保渲染完成
                    if (ext === '.pdf') {
                        await new Promise(r => setTimeout(r, 15000));
                    }
                    // 咔嚓！截图拿到纯净的 PNG Base64
                    finalPngBase64 = await page.screenshot({ encoding: 'base64', type: 'png' });
                    logger_1.logger.info(`Browser screenshot successful.`);
                }
                catch (browserErr) {
                    logger_1.logger.error(`Browser rendering failed: ${browserErr.message}`);
                    return `Error: Failed to render file via browser. Details: ${browserErr.message}`;
                }
                finally {
                    // 扫尾工作：关闭浏览器并删除临时文件
                    if (browser)
                        await browser.close();
                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                        await fs.promises.unlink(tempFilePath).catch(() => { });
                    }
                }
            }
            // ==========================================
            // 3. 构建并发送 Vision API 请求
            // ==========================================
            const requestBody = {
                model: model,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: { url: `data:image/png;base64,${finalPngBase64}` }
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            };
            logger_1.logger.info(`Sending request to Vision API`);
            const response = await axios_1.default.post(apiUrl, requestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                }
            });
            const resultText = response.data?.choices?.[0]?.message?.content || "No content returned.";
            return `【Image Vision Result (${isRemote ? 'Remote' : 'Local'})】\n${resultText}`;
        }
        catch (error) {
            const errorData = error.response?.data ? JSON.stringify(error.response.data) : '';
            return `Error calling Vision API: ${error.message}\n${errorData}`.trim();
        }
    };
}
function getPrompt() {
    return {
        name: "image_vision",
        description: "Reads ANY visual file (PNG, JPG, WEBP, SVG, GIF, PDF) from LOCAL or REMOTE paths. Complex files like PDFs are rendered securely via a headless browser to extract a high-fidelity screenshot for the Vision AI.",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "The instructions or questions for the vision model."
                },
                file_path: {
                    type: "string",
                    description: "The absolute or relative path to the file. Supports all common images and PDFs."
                }
            },
            required: ["prompt", "file_path"]
        }
    };
}
//# sourceMappingURL=image_vision.js.map