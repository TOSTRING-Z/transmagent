"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatString = formatString;
function formatString(template, data) {
    return template.replace(/(\{.*?\})/g, (match) => {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            return new Function(...keys, `return \`$${match}\`;`)(...values);
        }
        catch (e) {
            // console.error(`Format error: ${e.message}`);
            return match;
        }
    });
}
