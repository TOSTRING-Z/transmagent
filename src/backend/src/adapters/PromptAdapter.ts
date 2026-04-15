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
            // 2. 核心防御：在解析前，先剥离模型可能产生的首尾“废话”
            const pureJsonStr = utils.extractJson(contentStr);
            
            if (pureJsonStr) {
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
                        tool_call_id: call?.id || `call_${Date.now()}_${i}`, // 提供更可靠的伪 ID
                        params: call?.params || {},
                        error: null
                    });
                }
            } else {
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

        } catch (error: any) {
            // 3. 降级处理：找到了括号但格式彻底损坏
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