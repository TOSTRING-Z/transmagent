import { v4 as uuidv4 } from 'uuid';
const CLI_TOOLS = ['cli_execute'];
// ---- Shared garbage detection ----
const INTERRUPT_PATTERN = /^(继续|继续吧|继续执行|go\s*on|continue|next|下一步|好了|ok|好的|行|可以|嗯|哦|知道了|明白|收到|明白了|了解|懂了)(?:\b|$)/i;
// Tool results that are purely progress/status updates, not data
const STATUS_UPDATE_PATTERNS = [
    /^📋\s*结果:/, // "📋 结果: record_subtasks ✓ 成功"
    /^Successfully marked \d+ steps?/, // "Successfully marked 1 steps as 'completed'."
    /^剩余待处理:/, // "剩余待处理: 0"
    /^步骤\s*\d+\/\d+/, // "步骤 3/10"
    /^已完成/, // "已完成..."
    /^执行(完成|完毕|结束)/, // "执行完成"
    /^任务状态(更新|同步|检查)/, // task status updates
    /^🔧\s*\w+\s*[:：]\s*(成功|完成|ok)/i, // "🔧 tool_name: 成功"
];
/**
 * Returns true if the message is garbage and should be excluded from extraction.
 * Used by both deterministic classifier and LLM batch builder.
 */
export function isGarbageMessage(msg, idx) {
    const hasContent = (msg.content || '').trim().length > 0;
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    // 1. Empty messages
    if (!hasContent && !hasToolCalls)
        return true;
    const content = (msg.content || '').trim();
    // 2. User interrupt/nudge messages
    if (msg.role === 'user' && idx > 0 && INTERRUPT_PATTERN.test(content)) {
        return true;
    }
    // 3. Tool result status updates (progress indicators, task status, etc.)
    if (msg.role === 'tool' && hasContent) {
        for (const pattern of STATUS_UPDATE_PATTERNS) {
            if (pattern.test(content))
                return true;
        }
    }
    return false;
}
/**
 * Classify every message individually — no context_id grouping.
 * Each message produces one block.
 */
export function classifyDeterministic(json) {
    const messages = json.messages;
    const stageMap = detectStages(messages);
    const results = [];
    for (let i = 0; i < messages.length; i++) {
        const classification = classifyMessage(messages[i], i, stageMap.get(i) || 1);
        if (classification) {
            results.push(classification);
        }
    }
    return results;
}
function classifyMessage(msg, idx, stage) {
    const msgId = String(idx);
    if (isGarbageMessage(msg, idx))
        return null;
    // User message → ConversationBubble
    if (msg.role === 'user') {
        return {
            groupId: msgId,
            componentType: 'ConversationBubble',
            importanceScore: 0.9,
            summary: truncate(msg.content, 100),
            stage,
        };
    }
    // Assistant message
    if (msg.role === 'assistant') {
        // Has tool calls → ToolCallCard or CodeBlock
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            const toolNames = msg.tool_calls.map(tc => tc.function.name);
            if (toolNames.some(n => CLI_TOOLS.includes(n))) {
                return {
                    groupId: msgId,
                    componentType: 'CodeBlock',
                    importanceScore: 0.7,
                    summary: `执行命令: ${truncate(extractCommand(msg), 80)}`,
                    stage,
                };
            }
            return {
                groupId: msgId,
                componentType: 'ToolCallCard',
                importanceScore: 0.6,
                summary: `工具调用: ${toolNames.join(', ')}`,
                stage,
            };
        }
        // Plain assistant text (no tool calls)
        if (msg.content.length > 500) {
            return {
                groupId: msgId,
                componentType: 'ThinkingBlock',
                importanceScore: 0.5,
                summary: truncate(msg.content, 100),
                stage,
            };
        }
        if (msg.content.length > 0) {
            return {
                groupId: msgId,
                componentType: 'ConversationBubble',
                importanceScore: 0.3,
                summary: truncate(msg.content, 100),
                stage,
            };
        }
        return null; // empty assistant message — skip
    }
    // Tool message → ToolResultCard
    if (msg.role === 'tool') {
        const toolName = msg.tool_call_name || '';
        return {
            groupId: msgId,
            componentType: 'ToolResultCard',
            importanceScore: 0.6,
            summary: `工具结果: ${toolName}`,
            stage,
        };
    }
    return null;
}
/**
 * Detect stage per message index.
 * Each new env key set via update_env advances the stage.
 */
function detectStages(messages) {
    const stageMap = new Map();
    let currentStage = 1;
    const seenKeys = new Set();
    for (let i = 0; i < messages.length; i++) {
        stageMap.set(i, currentStage);
        const msg = messages[i];
        if (msg.role === 'tool' && msg.tool_call_name === 'update_env') {
            try {
                const content = JSON.parse(msg.content);
                if (content.key && typeof content.key === 'string' && !seenKeys.has(content.key)) {
                    seenKeys.add(content.key);
                    currentStage = Math.min(seenKeys.size + 1, 10);
                }
            }
            catch {
                // Not JSON — skip
            }
        }
    }
    // Ensure monotonic: stage never decreases as message index increases
    let maxStage = 1;
    for (const [idx, stage] of stageMap) {
        if (stage > maxStage)
            maxStage = stage;
        stageMap.set(idx, maxStage);
    }
    return stageMap;
}
function extractCommand(msg) {
    if (!msg.tool_calls)
        return '';
    for (const tc of msg.tool_calls) {
        if (CLI_TOOLS.includes(tc.function.name)) {
            try {
                const args = JSON.parse(tc.function.arguments);
                return args.command || args.cmd || '';
            }
            catch {
                return tc.function.arguments.slice(0, 80);
            }
        }
    }
    return '';
}
function truncate(text, maxLen) {
    const cleaned = text.replace(/\n/g, ' ').trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
}
// ---- Assemble CuratedBlocks from classification results ----
export function assembleBlocks(json, results) {
    const messages = json.messages;
    return results
        .filter(r => r.importanceScore > 0)
        .map(r => {
        // SummaryCard from LLM has _summary_ as groupId — no message lookup
        if (r.groupId === '_summary_') {
            return {
                id: uuidv4(),
                groupIds: ['_summary_'],
                componentType: r.componentType,
                importanceScore: r.importanceScore,
                summary: r.summary,
                stage: r.stage,
                content: { findings: r.findings || [] },
            };
        }
        const msgIdx = parseInt(r.groupId, 10);
        const msg = isNaN(msgIdx) ? undefined : messages[msgIdx];
        const block = {
            id: uuidv4(),
            groupIds: [r.groupId],
            componentType: r.componentType,
            importanceScore: r.importanceScore,
            summary: r.summary,
            stage: r.stage,
            content: msg ? extractMessageContent(msg, r.componentType) : {},
        };
        return block;
    });
}
function extractMessageContent(msg, type) {
    switch (type) {
        case 'ConversationBubble':
            return {
                message: msg.content,
                role: msg.role === 'user' ? 'user' : 'assistant',
            };
        case 'ToolCallCard': {
            const tc = msg.tool_calls?.[0];
            return {
                toolName: tc?.function.name || '',
                toolArgs: tc ? safeJsonParse(tc.function.arguments) : undefined,
            };
        }
        case 'ToolResultCard':
            return {
                toolName: msg.tool_call_name || '',
                toolResult: msg.content?.slice(0, 5000),
            };
        case 'CodeBlock': {
            const tc = msg.tool_calls?.find(t => CLI_TOOLS.includes(t.function.name));
            return {
                command: tc ? extractCommandFromTc(tc) : '',
                output: msg.content?.slice(0, 3000),
            };
        }
        case 'WorkflowStage':
            return {
                stageName: msg.content?.slice(0, 100) || 'Stage',
                stageDescription: msg.content?.slice(0, 500),
            };
        case 'FilePreview': {
            const isTabular = /\|[\s\w]+\|[\s\w]+\|/.test(msg.content?.slice(0, 200) || '');
            return {
                fileName: extractFileName(msg),
                fileContent: msg.content?.slice(0, 5000),
                isTabular,
            };
        }
        case 'ThinkingBlock':
            return {
                thinking: msg.content || '',
            };
        case 'SummaryCard': {
            const lines = (msg.content || '')
                .split('\n')
                .filter(l => l.trim().length > 10)
                .slice(0, 10);
            return {
                findings: lines.length > 0 ? lines : [msg.content?.slice(0, 200) || ''],
            };
        }
        default:
            return {};
    }
}
function extractCommandFromTc(tc) {
    try {
        const args = JSON.parse(tc.function.arguments);
        return args.command || args.cmd || JSON.stringify(args);
    }
    catch {
        return tc.function.arguments;
    }
}
function extractFileName(msg) {
    try {
        const content = JSON.parse(msg.content);
        return content.file || content.path || '';
    }
    catch {
        const match = msg.content.match(/Remote Source[:\s]*[`"]?(.+?)[`"\n]/);
        return match ? match[1] : '';
    }
}
function safeJsonParse(str) {
    try {
        return JSON.parse(str);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=deterministic.js.map