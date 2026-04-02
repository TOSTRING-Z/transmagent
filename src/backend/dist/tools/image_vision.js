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
            if (!prompt || !file_path)
                return "Error: 'prompt' and 'file_path' are required.";
            const apiUrl = params.api_url || "https://api.openai.com/v1/chat/completions";
            const apiKey = params.api_key;
            const model = params.model || "gpt-4o";
            if (!apiKey)
                return "Error: 'api_key' is missing.";
            const sshConfig = globals_1.utils.getSshConfig ? globals_1.utils.getSshConfig() : null;
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
            let fileBuffer;
            const ext = path.extname(file_path).toLowerCase();
            // 1. 读取文件 (兼容远程/本地)
            try {
                if (isRemote) {
                    fileBuffer = await new Promise((resolve, reject) => {
                        const conn = new ssh2_1.Client();
                        conn.on('ready', () => {
                            conn.sftp((err, sftp) => {
                                if (err)
                                    return reject(err);
                                const targetPath = file_path.replace(/\\/g, '/');
                                sftp.readFile(targetPath, (readErr, data) => {
                                    conn.end();
                                    if (readErr)
                                        reject(readErr);
                                    else
                                        resolve(data);
                                });
                            });
                        }).on('error', reject).connect({ ...sshConfig, readyTimeout: 30000 });
                    });
                }
                else {
                    if (!fs.existsSync(file_path))
                        return `Error: File not found: ${file_path}`;
                    fileBuffer = await fs.promises.readFile(file_path);
                }
            }
            catch (err) {
                return `Error reading file: ${err.message}`;
            }
            let finalPngBase64 = "";
            // 2. 转换逻辑
            if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
                finalPngBase64 = fileBuffer.toString('base64');
            }
            else {
                logger_1.logger.info(`Processing ${ext} via Puppeteer...`);
                let browser;
                let tempFilePath = "";
                try {
                    tempFilePath = path.join(os.tmpdir(), `vision_${Date.now()}${ext}`);
                    await fs.promises.writeFile(tempFilePath, fileBuffer);
                    browser = await puppeteer_1.default.launch({
                        headless: true,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--allow-file-access-from-files',
                            '--disable-dev-shm-usage', // 防止大 PDF 内存溢出
                            '--disable-gpu'
                        ]
                    });
                    const page = await browser.newPage();
                    // 提升 Dpifactor 保证文字清晰，模型识别更准
                    await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 2 });
                    const fileUrl = `file://${tempFilePath.replace(/\\/g, '/')}`;
                    // 优化点：PDF 加载不能用 networkidle2
                    await page.goto(fileUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 45000
                    });
                    if (ext === '.pdf') {
                        // 动态等待：检测 PDF 插件是否挂载完成
                        await page.waitForSelector('embed', { timeout: 10000 }).catch(() => { });
                        // 给 PDF 渲染引擎留出解析矢量图形的时间
                        await new Promise(r => setTimeout(r, 4000));
                    }
                    else {
                        // SVG 或 HTML 等待网络静默
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    finalPngBase64 = await page.screenshot({
                        encoding: 'base64',
                        type: 'png',
                        fullPage: ext !== '.pdf' // PDF 截取首屏通常足够，HTML 建议全页
                    });
                }
                catch (browserErr) {
                    return `Render Error: ${browserErr.message}`;
                }
                finally {
                    if (browser)
                        await browser.close();
                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                        await fs.promises.unlink(tempFilePath).catch(() => { });
                    }
                }
            }
            // 3. Vision API 请求
            const response = await axios_1.default.post(apiUrl, {
                model: model,
                messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: `data:image/png;base64,${finalPngBase64}` } }
                        ]
                    }],
                max_tokens: 1024
            }, {
                headers: { "Authorization": `Bearer ${apiKey}` },
                timeout: 60000 // 防止 API 端超时
            });
            return `【Vision Result】\n${response.data?.choices?.[0]?.message?.content}`;
        }
        catch (error) {
            return `System Error: ${error.message}`;
        }
    };
}
function getPrompt() {
    return {
        name: "image_vision",
        description: "Analyze any image or PDF file (local or remote). High-fidelity rendering included.",
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Question about the file content." },
                file_path: { type: "string", description: "Path to the file." }
            },
            required: ["prompt", "file_path"]
        }
    };
}
//# sourceMappingURL=image_vision.js.map