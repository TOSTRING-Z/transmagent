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
exports.main = main;
exports.getPrompt = getPrompt;
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
function main() {
    return async (params) => {
        try {
            if (!params || !params.url) {
                throw new Error('URL parameter is required');
            }
            const url = params.url;
            const text_max_len = params.text_max_len || 2000;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept-Language': 'zh-CN,zh;q=0.9'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            const $ = cheerio.load(html);
            // 移除无关的杂项元素
            $('script, style, noscript, iframe').remove();
            // 提取正文
            const contentElements = $('body');
            const text = contentElements.text().trim();
            // 原生方式合并连续空白符（替代原 string 库的 collapseWhitespace）
            const collapsedText = text.replace(/\s+/g, ' ').trim();
            const result = {
                url: url,
                text: collapsedText.slice(0, text_max_len)
            };
            logger_1.logger.log('fetch_url result:', result);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`fetch_url error: ${error.message}`);
            return {
                error: error.message
            };
        }
    };
}
function getPrompt() {
    return {
        "name": "fetch_url",
        "description": "Fetch content from a given web URL",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "(Required) URL to fetch content from"
                },
                "text_max_len": {
                    "type": "number",
                    "description": "(Optional) Maximum length of text to return, default is 2000 characters"
                }
            },
            "required": [
                "url"
            ]
        }
    };
}
//# sourceMappingURL=fetch_url.js.map