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
const child_process_1 = require("child_process");
const axios_1 = __importDefault(require("axios"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
function main(params) {
    return async (args) => {
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
                const output = (0, child_process_1.execSync)(`powershell.exe -Command "${cleanCmd}"`, {
                    maxBuffer: 1024 * 1024 * 50
                });
                base64Image = output.toString().trim();
            }
            else if (platform === 'darwin') {
                const tmpfile = `/tmp/screenshot_${Date.now()}.png`;
                (0, child_process_1.execSync)(`screencapture -x ${tmpfile}`);
                base64Image = fs.readFileSync(tmpfile, { encoding: 'base64' });
                fs.unlinkSync(tmpfile);
            }
            else if (platform === 'linux') {
                const tmpfile = `/tmp/screenshot_${Date.now()}.png`;
                (0, child_process_1.execSync)(`scrot ${tmpfile} || gnome-screenshot -f ${tmpfile}`);
                base64Image = fs.readFileSync(tmpfile, { encoding: 'base64' });
                fs.unlinkSync(tmpfile);
            }
            else {
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
            const response = await axios_1.default.post(apiUrl, requestBody, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                }
            });
            const resultText = response.data?.choices?.[0]?.message?.content || "No content returned.";
            return `【Vision Result】\n${resultText}`;
        }
        catch (error) {
            const errorData = error.response?.data ? JSON.stringify(error.response.data) : '';
            return `Error calling Vision API: ${error.message}\n${errorData}`.trim();
        }
    };
}
function getPrompt() {
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
//# sourceMappingURL=screenshot_vision.js.map