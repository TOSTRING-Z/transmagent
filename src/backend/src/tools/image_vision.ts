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
            const model = params.model || "gpt-5.4-mini";

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

            // 2. 核心转换逻辑路由
            if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
                // A. 图片直接转 Base64
                finalPngBase64 = fileBuffer.toString('base64');
                
            } else if (ext === '.pdf') {
                // B. PDF 终极逃课方案：离线 Puppeteer + 本地 PDF.js 源码注入
                logger.info(`Rendering PDF via Offline Puppeteer + local pdf.js...`);
                let browser;
                let tempHtmlPath = "";

                try {
                    browser = await puppeteer.launch({
                        headless: true,
                        args: [
                            '--no-sandbox', 
                            '--disable-setuid-sandbox', 
                            '--allow-file-access-from-files',
                            '--disable-web-security', // 允许本地 HTML 跨域读取本地 JS
                            '--disable-dev-shm-usage',
                            '--disable-gpu'
                        ]
                    });

                    const page = await browser.newPage();
                    // 提升 DPI 保证文字清晰
                    await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 2 });

                    // 1. 获取本地 pdfjs-dist 的绝对路径 (兼容 v3 和 v5)
                    let pdfJsPath, pdfWorkerPath;
                    try {
                        // 直接使用 Node.js 原生的 require.resolve
                        pdfJsPath = require.resolve('pdfjs-dist/legacy/build/pdf.js');
                        pdfWorkerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
                    } catch (e) {
                        pdfJsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
                        pdfWorkerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
                    }

                    // 转换路径格式以适应 file:// 协议
                    const jsUrl = `file://${pdfJsPath.replace(/\\/g, '/')}`;
                    const workerUrl = `file://${pdfWorkerPath.replace(/\\/g, '/')}`;
                    
                    // 将 PDF 转为 Base64 塞入 HTML，规避 Puppeteer 环境下极其复杂的本地文件读取权限
                    const pdfBase64 = fileBuffer.toString('base64');

                    // 2. 构建离线 HTML
                    const htmlContent = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <style>body, html { margin: 0; padding: 0; display: flex; justify-content: center; background: white; }</style>
                            <script src="${jsUrl}"></script>
                        </head>
                        <body>
                            <canvas id="pdf-canvas"></canvas>
                            <script>
                                // 设置 Worker 路径
                                pdfjsLib.GlobalWorkerOptions.workerSrc = '${workerUrl}';
                                
                                // 解析 Base64
                                const pdfData = atob('${pdfBase64}');
                                const uint8Array = new Uint8Array(pdfData.length);
                                for (let i = 0; i < pdfData.length; i++) {
                                    uint8Array[i] = pdfData.charCodeAt(i);
                                }

                                // 渲染逻辑
                                pdfjsLib.getDocument({data: uint8Array}).promise.then(pdf => {
                                    return pdf.getPage(1); // 取第一页
                                }).then(page => {
                                    const viewport = page.getViewport({ scale: 2.0 });
                                    const canvas = document.getElementById('pdf-canvas');
                                    canvas.width = viewport.width;
                                    canvas.height = viewport.height;
                                    return page.render({
                                        canvasContext: canvas.getContext('2d'),
                                        viewport: viewport
                                    }).promise;
                                }).then(() => {
                                    // 渲染成功打上标记
                                    document.body.setAttribute('data-done', 'true');
                                }).catch(err => {
                                    document.body.setAttribute('data-error', err.message);
                                });
                            </script>
                        </body>
                        </html>
                    `;

                    // 3. 写入临时 HTML 并让 Puppeteer 打开
                    tempHtmlPath = path.join(os.tmpdir(), `offline_pdf_${Date.now()}.html`);
                    await fs.promises.writeFile(tempHtmlPath, htmlContent);
                    
                    await page.goto(`file://${tempHtmlPath.replace(/\\/g, '/')}`, { waitUntil: 'domcontentloaded' });
                    
                    // 4. 等待渲染完成标记
                    await page.waitForSelector('body[data-done="true"], body[data-error]', { timeout: 30000 });
                    const errorMsg = await page.evaluate(() => document.body.getAttribute('data-error'));
                    if (errorMsg) throw new Error("Local PDF.js Render Error: " + errorMsg);

                    // 5. 截图拔线
                    finalPngBase64 = await page.screenshot({ encoding: 'base64', type: 'png', fullPage: true }) as string;

                } catch (err: any) {
                    return `PDF Render Error: ${err.message}`;
                } finally {
                    if (browser) await browser.close();
                    if (tempHtmlPath && fs.existsSync(tempHtmlPath)) {
                        await fs.promises.unlink(tempHtmlPath).catch(() => {});
                    }
                }

            } else {
                // C. HTML / SVG 等网页格式照常走 Puppeteer
                logger.info(`Processing ${ext} via Puppeteer...`);
                let browser;
                let tempFilePath = "";

                try {
                    tempFilePath = path.join(os.tmpdir(), `vision_${Date.now()}${ext}`);
                    await fs.promises.writeFile(tempFilePath, fileBuffer);

                    browser = await puppeteer.launch({
                        headless: false,
                        args: [
                            '--no-sandbox', 
                            '--disable-setuid-sandbox', 
                            '--allow-file-access-from-files',
                            '--disable-dev-shm-usage',
                            '--disable-gpu'
                        ]
                    });

                    const page = await browser.newPage();
                    await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 2 });

                    const fileUrl = `file://${tempFilePath.replace(/\\/g, '/')}`;
                    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 45000 });

                    finalPngBase64 = await page.screenshot({ 
                        encoding: 'base64', 
                        type: 'png',
                        fullPage: true 
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
                timeout: 60000 
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
        description: "Analyze images, PDFs, or web files (local/remote).",
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "The specific question or instruction regarding the file's visual content." },
                file_path: { type: "string", description: "Full path to the file. Supports .png, .jpg, .pdf, .html, .svg." }
            },
            required: ["prompt", "file_path"]
        }
    };
}