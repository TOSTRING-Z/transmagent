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
        
        console.log('fetch_url result:', result);
        return result;
        
    } catch (error) {
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
    } catch (e) {
        console.error(e);
        return {error: e.message};
    }
}

function getPrompt() {
    return `## fetch_url

Description: Lightweight HTTP client to scrape text content from a specific URL.
**Best Practice**: Use for static pages (docs, blogs). For complex JS-heavy sites, use 'browser_client'.
**Default Behavior**: Truncates content at 2000 characters to protect context window.

Parameters:
- url: (Required, String) Target HTTP/HTTPS URL.
- text_max_len: (Optional, Int) Override character limit (Default: 2000).

### Usage

**1. Quick Summary (Default limit)**
<root>
  <thinking>Reading the introductory paragraph of the documentation.</thinking>
  <tool_call>
    <name>fetch_url</name>
    <parameters>
      <url>https://api.example.com/v1/intro</url>
    </parameters>
  </tool_call>
</root>

**2. Deep Dive (Extended limit)**
<root>
  <thinking>Fetching the full article for detailed analysis.</thinking>
  <tool_call>
    <name>fetch_url</name>
    <parameters>
      <url>https://research.org/paper-123.html</url>
      <text_max_len>10000</text_max_len>
    </parameters>
  </tool_call>
</root>`;
}

module.exports = {
    main,
    getPrompt
};