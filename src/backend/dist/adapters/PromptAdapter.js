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
exports.PromptToolCallAdapter = void 0;
const json5_1 = __importDefault(require("json5"));
const utils = __importStar(require("../utils/public"));
class PromptToolCallAdapter {
    // 1. 将正则提取为静态常量，避免每次调用重复编译，提升性能
    static THINKING_PATTERNS = [
        /<thinking>([\s\S]*?)<\/thinking>/gi,
        /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
        /<think>([\s\S]*?)<\/think>/gi,
        /```thinking\n([\s\S]*?)\n```/gi,
        /<thinking_process>([\s\S]*?)<\/thinking_process>/gi,
    ];
    formatTools(toolSchemas) {
        const tool_prompt = {};
        for (const schema of toolSchemas) {
            if (schema.type === "raw_string") {
                tool_prompt[schema.name] = schema.content;
                continue;
            }
            let paramsStr = '';
            const exampleParams = {};
            if (schema.parameters?.properties) {
                for (const [key, prop] of Object.entries(schema.parameters.properties)) {
                    const isRequired = schema.parameters.required?.includes(key);
                    const reqLabel = isRequired ? "(Required)" : "(Optional)";
                    paramsStr += `- ${key}: ${reqLabel} ${prop.description || ''}\n`;
                    if (isRequired) {
                        exampleParams[key] = `[${prop.type} value]`;
                    }
                }
            }
            const usageObj = { thinking: "[Thinking process]", tool: schema.name, params: exampleParams };
            const usageStr = JSON.stringify(usageObj, null, 2).replace(/\n/g, '\\n');
            tool_prompt[schema.name] = `### ${schema.name}\nDescription: ${schema.description}\n\nParameters:\n${paramsStr}\nUsage:\n${usageStr}`;
        }
        return tool_prompt;
    }
    getToolInfos(message) {
        let toolInfos = [];
        const contentStr = message.content || "";
        let reasoningContent = message.reasoning_content || this.extractReasoning(contentStr);
        try {
            // 2. 核心防御：在解析前，先剥离模型可能产生的首尾“废话”
            const pureJsonStr = utils.extractJson(contentStr);
            if (pureJsonStr) {
                let aiResponse = utils.parseJsonContent(pureJsonStr);
                if (!aiResponse) {
                    aiResponse = json5_1.default.parse(pureJsonStr);
                }
                const calls = Array.isArray(aiResponse) ? aiResponse : [aiResponse];
                for (let i = 0; i < calls.length; i++) {
                    const call = calls[i];
                    if (!call.content && !call?.tool) {
                        toolInfos.push(this.createErrorToolInfo(reasoningContent, contentStr, `Tool parsing failed at index ${i}: Missing 'tool' or 'content' fields.`));
                        continue;
                    }
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: call.content || "",
                        tool_call_name: call?.tool || null,
                        tool_call_id: call?.id || `call_${Date.now()}_${i}`, // 提供更可靠的伪 ID
                        params: call?.params || {},
                        error: null
                    });
                }
            }
            else {
                // 如果找不到任何类 JSON 结构，视为纯文本闲聊
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: contentStr,
                    tool_call_name: null,
                    tool_call_id: null,
                    params: {},
                    error: null
                });
            }
        }
        catch (error) {
            // 3. 降级处理：找到了括号但格式彻底损坏
            toolInfos.push(this.createErrorToolInfo(reasoningContent, contentStr, error.message));
        }
        if (toolInfos.length === 0) {
            toolInfos.push({ reasoning_content: reasoningContent || null, content: contentStr, tool_call_name: null, tool_call_id: null, params: {}, error: null });
        }
        return toolInfos;
    }
    extractText(message) {
        return typeof message.content === 'string' ? message.content : "";
    }
    /**
     * 提取思考过程内容
     */
    extractReasoning(text) {
        for (const pattern of PromptToolCallAdapter.THINKING_PATTERNS) {
            // 重置正则的 lastIndex 防止全局匹配状态残留
            pattern.lastIndex = 0;
            const match = pattern.exec(text);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        return "";
    }
    /**
     * 统一构造错误状态的 ToolInfo
     */
    createErrorToolInfo(reasoning, rawContent, errMsg) {
        return {
            reasoning_content: reasoning,
            content: `\`\`\`text\n${rawContent}\n\`\`\`\n\n**System Error:** Function calling is not a pure JSON text, or format is corrupted.`,
            tool_call_name: null,
            tool_call_id: null,
            params: null,
            error: `Error Message: ${errMsg}`
        };
    }
}
exports.PromptToolCallAdapter = PromptToolCallAdapter;
//# sourceMappingURL=PromptAdapter.js.map