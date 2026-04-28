"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptToolCallAdapter = void 0;
const extract_json_from_string_1 = __importDefault(require("extract-json-from-string"));
const jsonrepair_1 = require("jsonrepair");
class PromptToolCallAdapter {
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
            const usageObj = { content: "[Briefly explain your current action to the user]", tool: schema.name, params: exampleParams };
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
            let extractedObjects = [];
            try {
                extractedObjects = (0, extract_json_from_string_1.default)(contentStr);
            }
            catch (e) {
                const repairedText = (0, jsonrepair_1.jsonrepair)(contentStr);
                extractedObjects = (0, extract_json_from_string_1.default)(repairedText);
            }
            let hasValidToolCall = false;
            // 【核心新增：用于记录已经处理过的工具调用指纹】
            const uniqueCallFingerprints = new Set();
            for (const aiResponse of extractedObjects) {
                const calls = Array.isArray(aiResponse) ? aiResponse : [aiResponse];
                for (let i = 0; i < calls.length; i++) {
                    const call = calls[i];
                    if (!call || typeof call !== 'object')
                        continue;
                    if (call.success !== undefined && !call.tool && !call.params)
                        continue;
                    if (!call.tool && !call.content)
                        continue;
                    // 【核心新增：生成唯一指纹】
                    // 将 tool 和 params 序列化为字符串。如果这两个完全一样，说明是重复提取的同一个动作
                    const fingerprintObj = {
                        tool: call.tool || null,
                        params: call.params || {}
                    };
                    const fingerprint = JSON.stringify(fingerprintObj);
                    // 如果这个指纹已经存在，说明是嵌套提取导致的重复，直接跳过
                    if (uniqueCallFingerprints.has(fingerprint)) {
                        continue;
                    }
                    // 记录新指纹
                    uniqueCallFingerprints.add(fingerprint);
                    hasValidToolCall = true;
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: call.content || "",
                        tool_call_name: call.tool || null,
                        tool_call_id: call.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        params: call.params || {},
                        error: null
                    });
                }
            }
            // 如果没有提取到任何有效工具，走兜底报错或闲聊逻辑
            if (!hasValidToolCall) {
                if (this.isIntendedToolCall(contentStr)) {
                    toolInfos.push(this.createErrorToolInfo(reasoningContent, contentStr, "Detected an attempt to call a tool, but the format is entirely corrupted."));
                }
                else {
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
        }
        catch (error) {
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
     * 【核心新增】判断字符串是否具有“工具调用”的意图
     * 即使格式损坏（如缺失引号、括号不匹配），只要符合关键特征即可判定
     */
    isIntendedToolCall(text) {
        // 特征 1：存在对象或数组的起始符号
        const hasJsonContainer = /\{|\[/.test(text);
        // 特征 2：存在核心工具调用的 key，如 tool:, params: (支持单双引号或无引号，支持任意空格)
        const hasToolKeys = /["']?(tool|params)["']?\s*:/i.test(text);
        // 只要同时满足存在容器符号和特征 key，就认为模型试图调用工具
        return hasJsonContainer && hasToolKeys;
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
// 1. 将正则提取为静态常量，避免每次调用重复编译，提升性能
PromptToolCallAdapter.THINKING_PATTERNS = [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
    /<think>([\s\S]*?)<\/think>/gi,
    /```thinking\n([\s\S]*?)\n```/gi,
    /<thinking_process>([\s\S]*?)<\/thinking_process>/gi,
];
