import { IToolCallAdapter } from './IAdapter';
import { AssistantMessage, Message, ToolInfo } from '../types';
import JSON5 from 'json5';
import * as utils from '../utils/public';

export class PromptToolCallAdapter implements IToolCallAdapter {
    // 1. 将正则提取为静态常量，避免每次调用重复编译，提升性能
    private static readonly THINKING_PATTERNS = [
        /<thinking>([\s\S]*?)<\/thinking>/gi,
        /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
        /<think>([\s\S]*?)<\/think>/gi,
        /```thinking\n([\s\S]*?)\n```/gi,
        /<thinking_process>([\s\S]*?)<\/thinking_process>/gi,
    ];

    formatTools(toolSchemas: any[]): any {
        const tool_prompt: Record<string, string> = {};

        for (const schema of toolSchemas) {
            if (schema.type === "raw_string") {
                tool_prompt[schema.name] = schema.content;
                continue;
            }

            let paramsStr = '';
            const exampleParams: Record<string, any> = {};

            if (schema.parameters?.properties) {
                for (const [key, prop] of Object.entries<any>(schema.parameters.properties)) {
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

    public getToolInfos(message: AssistantMessage): ToolInfo[] {
        let toolInfos: ToolInfo[] = [];
        const contentStr = message.content as string || "";
        let reasoningContent = message.reasoning_content || this.extractReasoning(contentStr);

        try {
            const pureJsonStr = utils.extractJson(contentStr);

            if (pureJsonStr) {
                // 1. 成功提取到括号内容，尝试解析
                let aiResponse: any = utils.parseJsonContent(pureJsonStr);
                if (!aiResponse) {
                    aiResponse = JSON5.parse(pureJsonStr);
                }

                const calls = Array.isArray(aiResponse) ? aiResponse : [aiResponse];

                for (let i = 0; i < calls.length; i++) {
                    const call = calls[i];

                    if (!call.content && !call?.tool) {
                        toolInfos.push(this.createErrorToolInfo(
                            reasoningContent,
                            contentStr,
                            `Tool parsing failed at index ${i}: Missing 'tool' or 'content' fields.`
                        ));
                        continue;
                    }

                    toolInfos.push({
                        reasoning_content: reasoningContent || null,
                        content: call.content || "",
                        tool_call_name: call?.tool || null,
                        tool_call_id: call?.id || `call_${Date.now()}_${i}`,
                        params: call?.params || {},
                        error: null
                    });
                }
            } else if (this.isIntendedToolCall(contentStr)) {
                // 2. 【核心新增】提取为空，但内容具有强烈的工具调用意图（格式损坏的 JSON）
                toolInfos.push(this.createErrorToolInfo(
                    reasoningContent,
                    contentStr,
                    "Detected an attempt to call a tool, but the JSON format is strictly invalid or corrupted. Please output strictly valid JSON."
                ));
            } else {
                // 3. 确实没有任何工具调用意图，视为纯文本闲聊
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: contentStr,
                    tool_call_name: null,
                    tool_call_id: null,
                    params: {},
                    error: null
                });
            }

        } catch (error: any) {
            // 解析时报错（找到了 JSON 结构但 JSON5 也救不回来）
            toolInfos.push(this.createErrorToolInfo(
                reasoningContent,
                contentStr,
                error.message
            ));
        }

        if (toolInfos.length === 0) {
            toolInfos.push({ reasoning_content: reasoningContent || null, content: contentStr, tool_call_name: null, tool_call_id: null, params: {}, error: null });
        }

        return toolInfos;
    }

    extractText(message: any): string {
        return typeof message.content === 'string' ? message.content : "";
    }

    /**
     * 提取思考过程内容
     */
    private extractReasoning(text: string): string {
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
    private isIntendedToolCall(text: string): boolean {
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
    private createErrorToolInfo(reasoning: string | null, rawContent: string, errMsg: string): ToolInfo {
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