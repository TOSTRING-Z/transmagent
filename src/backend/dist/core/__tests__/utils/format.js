"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatString = formatString;
function formatString(template, data) {
    return template.replace(/(\{.*?\})/g, function (match) {
        try {
            var keys = Object.keys(data);
            var values = Object.values(data);
            return new (Function.bind.apply(Function, __spreadArray(__spreadArray([void 0], keys, false), ["return `$".concat(match, "`;")], false)))().apply(void 0, values);
        }
        catch (e) {
            // console.error(`Format error: ${e.message}`);
            return match;
        }
    });
}
