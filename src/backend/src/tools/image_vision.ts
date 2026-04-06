import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client } from 'ssh2';
import puppeteer from 'puppeteer';
import { logger } from '../utils/logger';
import { ToolCall } from '../core/ToolCall';

export interface VisionParams {
    api_url?: string;
    api_key: string;
    model?: string;
}

export interface ToolArgs {
    prompt: string;
    file_path: string;
    toolCall: ToolCall;
}

export function main(params: VisionParams) {
    return async (args: ToolArgs): Promise<string> => {
        try {
            const { prompt, file_path, toolCall } = args;
            if (!prompt || !file_path) return "Error: 'prompt' and 'file_path' are required.";

            const apiUrl = params.api_url || "https://api.openai.com/v1/chat/completions";
            const apiKey = params.api_key;
            const model = params.model || "gpt-4o";

            if (!apiKey) return "Error: 'api_key' is missing.";

            const sshConfig = toolCall.utils.getSshConfig();
            const isRemote = !!(sshConfig?.enabled && sshConfig?.host);
            
            let fileBuffer: Buffer;
            const ext = path.extname(file_path).toLowerCase();

            // 1. 读取文件 (兼容远程/本地)
            try {
                if (isRemote) {
                    fileBuffer = await new Promise<Buffer>((resolve, reject) => {
                        const conn = new Client();
                        conn.on('ready', () => {
                            conn.sftp((err, sftp) => {
                                if (err) return reject(err);
                                const targetPath = file_path.replace(/\\/g, '/');
                                sftp.readFile(targetPath, (readErr, data) => {
                                    conn.end();
                                    if (readErr) reject(readErr); else resolve(data);
                                });
                            });
                        }).on('error', reject).connect({ ...sshConfig, readyTimeout: 30000 });
                    });
                } else {
                    if (!fs.existsSync(file_path)) return `Error: File not found: ${file_path}`;
                    fileBuffer = await fs.promises.readFile(file_path);
                }
            } catch (err: any) {
                return `Error reading file: ${err.message}`;
            }

            let finalPngBase64 = "";

            // 2. 转换逻辑
            if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
                finalPngBase64 = fileBuffer.toString('base64');
            } else {
                logger.info(`Processing ${ext} via Puppeteer...`);
                let browser;
                let tempFilePath = "";

                try {
                    tempFilePath = path.join(os.tmpdir(), `vision_${Date.now()}${ext}`);
                    await fs.promises.writeFile(tempFilePath, fileBuffer);

                    browser = await puppeteer.launch({
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
                        await page.waitForSelector('embed', { timeout: 10000 }).catch(() => {});
                        // 给 PDF 渲染引擎留出解析矢量图形的时间
                        await new Promise(r => setTimeout(r, 4000)); 
                    } else {
                        // SVG 或 HTML 等待网络静默
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    finalPngBase64 = await page.screenshot({ 
                        encoding: 'base64', 
                        type: 'png',
                        fullPage: ext !== '.pdf' // PDF 截取首屏通常足够，HTML 建议全页
                    }) as string;

                } catch (browserErr: any) {
                    return `Render Error: ${browserErr.message}`;
                } finally {
                    if (browser) await browser.close();
                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                        await fs.promises.unlink(tempFilePath).catch(() => {});
                    }
                }
            }

            // 3. Vision API 请求
            const response = await axios.post(apiUrl, {
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

        } catch (error: any) {
            return `System Error: ${error.message}`;
        }
    };
}

export function getPrompt() {
    return {
        name: "image_vision",
        // 在描述中增加了关于格式转换的明确说明
        description: "Analyze images, PDFs, or web files (local/remote). Note: All non-image formats (like PDF/HTML) will be automatically rendered into PNG images before analysis to ensure high-fidelity visual recognition.",
        parameters: {
            type: "object",
            properties: {
                prompt: { 
                    type: "string", 
                    description: "The specific question or instruction regarding the file's visual content." 
                },
                file_path: { 
                    type: "string", 
                    description: "Full path to the file. Supports .png, .jpg, .pdf, .html, .svg." 
                }
            },
            required: ["prompt", "file_path"]
        }
    };
}