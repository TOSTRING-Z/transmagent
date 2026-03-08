import { logger } from '../utils/logger';
const cheerio = require('cheerio');
const S = require('string');

async function fetchUrlContent({ url, text_max_len = 2000 }) {
    try {
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
        
        $('script, style, noscript, iframe').remove();
        
        const contentElements = $('body');
        let text = contentElements.text().trim();
        
        const result = {
            url: url,
            text: S(text).collapseWhitespace().s.slice(0, text_max_len)
        };
        
        logger.log('fetch_url result:', result);
        return result;
        
    } catch (error: any) {
        console.error('fetch_url error:', error);
        return {
            error: error.message
        };
    }
}

async function main(params) {
    try {
        const result = await fetchUrlContent(params);
        return result;
    } catch (e: any) {
        console.error(e);
        return {error: e.message};
    }
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

export {
    main,
    getPrompt
};