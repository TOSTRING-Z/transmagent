import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';

// --- 类型定义 ---
export interface FetchUrlArgs {
    url: string;
    text_max_len?: number;
}

export interface FetchUrlResult {
    url?: string;
    text?: string;
    error?: string;
}

export async function main(params: FetchUrlArgs): Promise<FetchUrlResult> {
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

        const result: FetchUrlResult = {
            url: url,
            text: collapsedText.slice(0, text_max_len)
        };

        logger.log('fetch_url result:', result);
        return result;

    } catch (error: any) {
        logger.error(`fetch_url error: ${error.message}`);
        return {
            error: error.message
        };
    }
}

export function getPrompt() {
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