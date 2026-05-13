export function getFileName(path) {
    return path.split('/').pop().split('\\').pop();
}
export function getTokens(text) {
    const normalizedText = text
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    const chineseTokens = normalizedText.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g) || [];
    const wordTokens = normalizedText.match(/[a-zA-Z_][a-zA-Z0-9_]*|\+\+|--|&&|\|\||[<>!=]=?|\d+\.?\d*|[^\s\u4e00-\u9fa5]/g) || [];
    return chineseTokens.length + wordTokens.length;
}
export function createElement(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.firstChild;
}
export function getIcon(is_plugin) {
    return is_plugin ? "api" : "ai";
}
export function formatString(template, params) {
    const formattedText = template.replace(/@(\w+)/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            return params[key];
        }
        else {
            console.warn(`Key "${key}" not found in params`);
            return match;
        }
    });
    return createElement(formattedText);
}
