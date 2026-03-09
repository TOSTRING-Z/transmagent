import { execSync } from 'child_process';
import axios from 'axios';
import * as os from 'os';
import * as fs from 'fs';

// --- 类型定义 ---
export interface VisionParams {
    api_url?: string;
    api_key: string;
    model?: string;
}

export interface ToolArgs {
    prompt: string;
}

export function main(params: VisionParams) {
    return async (args: ToolArgs): Promise<string> => {
        try {
            const { prompt } = args;
            if (!prompt) {
                return "Error: 'prompt' argument is required.";
            }
            
            const apiUrl = params.api_url || "https://api.openai.com/v1/chat/completions";
            const apiKey = params.api_key;
            const model = params.model || "gpt-4o";

            if (!apiKey) {
                return "Error: 'api_key' is missing in tool configuration.";
            }

            let base64Image = "";
            const platform = os.platform();
            
            // 截图逻辑
            if (platform === 'win32') {
                const psCommand = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap $bounds.width, $bounds.height;
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.size);
$stream = New-Object System.IO.MemoryStream;
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png);
$bytes = $stream.ToArray();
[Convert]::ToBase64String($bytes);
`;
                const cleanCmd = psCommand.replace(/[\r\n]+/g, ' ');
                const output = execSync(`powershell.exe -Command "${cleanCmd}"`, {
                    maxBuffer: 1024 * 1024 * 50
                });
                base64Image = output.toString().trim();
            } else if (platform === 'darwin') {
                const tmpfile = `/tmp/screenshot_${Date.now()}.png`;
                execSync(`screencapture -x ${tmpfile}`);
                base64Image = fs.readFileSync(tmpfile, { encoding: 'base64' });
                fs.unlinkSync(tmpfile);
            } else if (platform === 'linux') {
                const tmpfile = `/tmp/screenshot_${Date.now()}.png`;
                execSync(`scrot ${tmpfile} || gnome-screenshot -f ${tmpfile}`);
                base64Image = fs.readFileSync(tmpfile, { encoding: 'base64' });
                fs.unlinkSync(tmpfile);
            } else {
                return `Error: Unsupported OS platform for screenshot: ${platform}`;
            }

            if (!base64Image) {
                return "Error: Failed to capture screenshot.";
            }

            // 构建请求体
            const requestBody = {
                model: model,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/png;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            };

            // 发起 Vision API 请求
            const response = await axios.post(apiUrl, requestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                }
            });

            const resultText = response.data?.choices?.[0]?.message?.content || "No content returned.";
            return `【Vision Result】\n${resultText}`;

        } catch (error: any) {
            const errorData = error.response?.data ? JSON.stringify(error.response.data) : '';
            return `Error calling Vision API: ${error.message}\n${errorData}`.trim();
        }
    };
}

export function getPrompt() {
    return {
        name: "screenshot_vision",
        description: "Captures the current screen automatically and sends it to a Vision AI model along with your prompt to get visual analysis or answers.",
        parameters: {
            type: "object",
            properties: {
                prompt: {
                    type: "string",
                    description: "The instructions or questions to ask the vision model about the screen."
                }
            },
            required: ["prompt"]
        }
    };
}