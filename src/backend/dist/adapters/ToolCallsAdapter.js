"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolCallsAdapter = void 0;
/**
 * ToolCallsAdapter - 直接从 message.tool_calls 提取工具调用信息
 *
 * 适用于支持 Native Tool Calls 的 API：
 * - OpenAI API (function calling)
 *
 * 特点：
 * - 直接从 message.tool_calls 获取结构化数据
 * - 不需要解析 content 中的 JSON 字符串
 * - 更准确、更快速
 */
class ToolCallsAdapter {
    /**
     * 格式化工具描述为 API 支持的格式
     * OpenAI 格式: { type: "function", function: { name, description, parameters } }
     */
    formatTools(toolSchemas) {
        return toolSchemas.map(schema => {
            if (schema.type === "raw_string")
                return null;
            return { type: "function", function: schema };
        }).filter(Boolean);
    }
    /**
     * 从 assistant 消息中提取工具调用信息
     *
     * - OpenAI: message.tool_calls = [{ id, type, function: { name, arguments } }]
     */
    getToolInfos(message) {
        let toolInfos = [];
        const reasoningContent = message.reasoning_content || "";
        const textContent = typeof message.content === 'string' ? message.content : "";
        if (message?.tool_calls && message.tool_calls.length > 0) {
            for (let call of message.tool_calls) {
                try {
                    // 统一处理 OpenAI 和 Anthropic 格式
                    const name = call.function?.name;
                    const arguments_str = call.function?.arguments;
                    // 尝试解析 arguments 为对象
                    let params = {};
                    let parseError = null;
                    if (typeof arguments_str === 'string') {
                        try {
                            params = JSON.parse(arguments_str);
                        }
                        catch (e) {
                            parseError = `Arguments are not valid JSON: ${arguments_str}`;
                            // 如果解析失败，保留原始字符串
                            params = arguments_str;
                        }
                    }
                    else {
                        params = arguments_str || {};
                    }
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: textContent,
                        tool_call_name: name || null,
                        tool_call_id: call.id || null,
                        params: params,
                        error: parseError
                    });
                }
                catch (error) {
                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: textContent,
                        tool_call_name: call.function?.name || null,
                        tool_call_id: call.id || null,
                        params: call.function?.arguments || {},
                        error: `Error parsing tool call: ${error.message}`
                    });
                }
            }
        }
        else {
            // 没有 tool_calls，返回纯文本
            toolInfos.push({
                reasoning_content: reasoningContent || null,
                content: textContent,
                tool_call_name: null,
                tool_call_id: null,
                params: {},
                error: null
            });
        }
        return toolInfos;
    }
    /**
     * 提取消息中的纯文本内容（排除工具调用）
     */
    extractText(message) {
        if (typeof message.content === 'string') {
            return message.content;
        }
        // 如果是数组，找出文本类型的内容
        if (Array.isArray(message.content)) {
            const textParts = message.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n');
            return textParts;
        }
        return "";
    }
}
exports.ToolCallsAdapter = ToolCallsAdapter;
//# sourceMappingURL=ToolCallsAdapter.js.map