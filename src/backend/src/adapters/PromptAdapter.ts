import { IToolCallAdapter } from './IAdapter';
import { Message,ToolInfo } from '../types';
import JSON5 from 'json5';
import { utils } from '../utils/globals';

export class PromptToolCallAdapter implements IToolCallAdapter {
    formatTools(toolSchemas: any[]): any {
        const tool_prompt: Record<string, string> = {};

        for (const schema of toolSchemas) {
            if (schema.type === "raw_string") {
                tool_prompt[schema.name] = schema.content;
            } else {
                let paramsStr = '';
                const exampleParams: Record<string, string> = {};

                if (schema.parameters && schema.parameters.properties) {
                    for (const [key, prop] of Object.entries<any>(schema.parameters.properties)) {
                        const required = schema.parameters.required?.includes(key) ? "(Required)" : "(Optional)";
                        paramsStr += `- ${key}: ${required} ${prop.description || ''}\n`;
                        if (schema.parameters.required?.includes(key)) {
                            exampleParams[key] = `[${prop.type} value]`;
                        }
                    }
                }

                const usageObj = { thinking: "[Thinking process]", tool: schema.name, params: exampleParams };
                const usageStr = JSON.stringify(usageObj, null, 2).replace(/\n/g, '\\n');

                tool_prompt[schema.name] = `### ${schema.name}\nDescription: ${schema.description}\n\nParameters:\n${paramsStr}\nUsage:\n${usageStr}`;
            }
        }
        return tool_prompt;
    }

    public getToolInfos(message: Message): ToolInfo[] {
        let toolInfos: ToolInfo[] = [];
        const contentStr = message.content as string;
        let reasoningContent = message.reasoning_content || "";

        // 当 reasoningContent 为空时，尝试从 contentStr 中提取 <thinking> 标签
        if (!reasoningContent && typeof contentStr === 'string') {
            const thinkingPatterns = [
                /<thinking>([\s\S]*?)<\/thinking>/gi,
                /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
                /<think>([\s\S]*?)<\/think>/gi,
                /```thinking\n([\s\S]*?)\n```/gi,
                /<thinking_process>([\s\S]*?)<\/thinking_process>/gi,
            ];

            for (const pattern of thinkingPatterns) {
                const match = pattern.exec(contentStr);
                if (match && match[1]) {
                    reasoningContent = match[1].trim();
                    break;
                }
            }
        }

        try {
            // 尝试解析文本中的 JSON
            let aiResponse: any = utils.parseJsonContent(contentStr);
            if (!aiResponse) {
                aiResponse = JSON5.parse(contentStr);
            }

            // 兼容模型输出的是单工具对象 {...} 还是多工具数组 [...]
            const calls = Array.isArray(aiResponse) ? aiResponse : [aiResponse];

            for (let i = 0; i < calls.length; i++) {
                const call = calls[i];

                // 容错：如果解析出的对象既没有 content 也没有 tool
                if (!reasoningContent && !call.content && !call?.tool) {
                    toolInfos.push({
                        reasoning_content: null,
                        content: `\`\`\`text\n${contentStr}\n\`\`\`\n\n**Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                        tool: null,
                        // 生成一个伪id，便于追踪
                        id: `prompt_call_${Date.now()}_${i}`,
                        params: {},
                        error: `Error Message: Tool parsing failed at index ${i}`
                    });
                    continue;
                }

                // 正常解析推入数组
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: call.content || "",
                    tool: call?.tool || null,
                    // 原生Prompt没有ID，这里为并行调用生成一个伪唯一ID，或者使用模型自己生成的ID
                    id: call?.id || `prompt_call_${Date.now()}_${i}`,
                    params: call?.params || {},
                    error: null
                });
            }

        } catch (error: any) {
            // 解析失败时的降级处理
            const trimmedStr = contentStr.trim();
            if (trimmedStr.startsWith("```json") || trimmedStr.startsWith("{") || trimmedStr.startsWith("[")) {
                // 模型试图进行 JSON 输出但格式损坏
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: `\`\`\`text\n${contentStr}\n\`\`\`\n\n**Function calling is not a pure JSON text, or there is a problem with the JSON format.**`,
                    tool: null,
                    id: null,
                    params: {},
                    error: `Error Message: ${error.message}`
                });
            } else {
                // 纯文本思考，不含工具调用
                toolInfos.push({
                    reasoning_content: reasoningContent || null,
                    content: contentStr,
                    tool: null,
                    id: null,
                    params: {},
                    error: null
                });
            }
        }

        // 兜底：如果数组无论何种原因变为空，塞入一条纯文本记录
        if (toolInfos.length === 0) {
            toolInfos.push({ reasoning_content: reasoningContent || null, content: contentStr, tool: null, id: null, params: {}, error: null });
        }

        return toolInfos;
    }

    extractText(message: any): string {
        return typeof message.content === 'string' ? message.content : "";
    }
}