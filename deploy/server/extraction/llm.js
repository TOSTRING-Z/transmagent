import { classifyDeterministic, assembleBlocks, isGarbageMessage } from './deterministic.js';
import { getConfig, DEFAULT_EXTRACTION_PROMPT } from '../db/index.js';
const BATCH_CHAR_SIZE = 4000;
export const BATCH_PROMPT = `你是多智能体工作流日志清洗器。这是第 {{BATCH}}/{{TOTAL}} 批。

=== 核心规则：只输出有效消息，必须跳过以下垃圾（严禁保留） ===

1. 空消息 — content 为空或仅空白字符
2. 用户打断/催促 — 如 "[N] user: 继续" "[N] user: go on" "[N] user: 好的" "[N] user: ok" "[N] user: 嗯" "[N] user: 下一步" "[N] user: 知道了" "[N] user: 明白" "[N] user: 行" "[N] user: 可以" "[N] user: 哦" — 这些是催促语，不包含任何实质性指令，必须跳过
3. 错误重试 — CLI 命令报错(exit code != 0)及其紧接的重试，只保留最终成功的版本
4. 人工纠正 — ask_user 返回的纠正指令（如"不要用xxx，改用yyy"），跳过纠正过程只保留纠正后的结果
5. 琐碎浏览 — ls/cat/echo/pwd/which/type/head/tail 等仅查看不产出的操作
6. 进度播报 — 仅报告"已完成 N/M"而无实质结果
7. 重复命令 — 同一命令连续多次执行，只保留最后一次

有效消息（必须保留）：实质性用户指令 | 有产出的CLI命令 | 工具调用及结果 | 文件读写/数据分析 | assistant长文本推理(>200字) | update_env阶段切换 | 搜索/检索结果

=== 组件类型 ===
ConversationBubble: 用户实质指令 或 assistant短回复(<200字)
ToolCallCard: assistant调用工具(含函数名+参数)
ToolResultCard: tool返回执行结果
CodeBlock: CLI命令执行(Bash/cli_execute)
ThinkingBlock: assistant长文本推理(>200字)或搜索/研究结果
FilePreview: 表格数据或文件内容

输出纯JSON数组（仅有效消息，严禁markdown包装）:
[{"message_index":序号,"component_type":"类型","importance_score":0.0-1.0,"summary":"中文描述","stage":阶段号}]`;
export async function runLLMExtraction(json, onProgress) {
    const config = getConfig();
    const apiKey = config.deepseekApiKey
        || config.openaiApiKey
        || process.env.DEEPSEEK_API_KEY
        || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.log('[extraction] No LLM API key configured. Using deterministic results with enhanced summaries.');
        return enhanceDeterministic(json);
    }
    const isDeepSeek = !!(config.deepseekApiKey || process.env.DEEPSEEK_API_KEY)
        && config.preferredModel !== 'openai';
    try {
        const batches = buildBatches(json);
        console.log(`[extraction] Split ${json.messages.length} messages into ${batches.length} batches (~${BATCH_CHAR_SIZE} chars each)`);
        // === MAP PHASE ===
        const allBlocks = [];
        for (let i = 0; i < batches.length; i++) {
            onProgress?.({ batch: i + 1, totalBatches: batches.length, phase: 'extracting' });
            const batchPrompt = BATCH_PROMPT
                .replace(/\{\{BATCH\}\}/g, String(i + 1))
                .replace(/\{\{TOTAL\}\}/g, String(batches.length))
                + '\n\n=== 消息列表 ===\n' + batches[i];
            console.log(`[extraction] Processing batch ${i + 1}/${batches.length} (${batches[i].length} chars)`);
            try {
                const response = await callLLM(apiKey, batchPrompt, isDeepSeek, 4096);
                const batchBlocks = parseBatchResponse(response, i + 1);
                console.log(`[extraction] Batch ${i + 1}: extracted ${batchBlocks.length} blocks`);
                allBlocks.push(...batchBlocks);
            }
            catch (err) {
                console.error(`[extraction] Batch ${i + 1} failed:`, err);
            }
        }
        if (allBlocks.length === 0) {
            console.log('[extraction] All batches failed, falling back to deterministic');
            return enhanceDeterministic(json);
        }
        console.log(`[extraction] Map phase complete: ${allBlocks.length} blocks from ${batches.length} batches`);
        // === REDUCE PHASE ===
        onProgress?.({ batch: batches.length, totalBatches: batches.length, phase: 'merging' });
        const consolidated = await consolidateBlocks(allBlocks, json, apiKey, isDeepSeek);
        return consolidated;
    }
    catch (err) {
        console.error('[extraction] LLM extraction failed, falling back to enhanced deterministic:', err);
        return enhanceDeterministic(json);
    }
}
// Build batches from individual messages, skipping empty ones
function buildBatches(json) {
    const messages = json.messages;
    const batches = [];
    let current = '';
    let charCount = 0;
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        // Skip garbage messages (shared filter with deterministic)
        if (isGarbageMessage(msg, i))
            continue;
        const tool = msg.tool_call_name || msg.tool_calls?.[0]?.function.name || '';
        const toolStr = tool ? ` (${tool})` : '';
        const preview = msg.content.slice(0, 250).replace(/\n/g, ' ').trim() || '(空)';
        const line = `[${i}] ${msg.role}${toolStr}: ${preview}\n`;
        if (charCount + line.length > BATCH_CHAR_SIZE && current.length > 0) {
            batches.push(current);
            current = line;
            charCount = line.length;
        }
        else {
            current += line;
            charCount += line.length;
        }
    }
    if (current.length > 0) {
        batches.push(current);
    }
    return batches;
}
function parseBatchResponse(response, batchNum) {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
    const cleanJson = (jsonMatch[1] || response).trim();
    try {
        const blocks = JSON.parse(cleanJson);
        if (!Array.isArray(blocks)) {
            console.warn(`[extraction] Batch ${batchNum}: response is not an array`);
            return [];
        }
        return blocks
            .filter((b) => b.message_index != null && b.message_index !== '_summary_')
            .map((b) => ({
            groupId: String(b.message_index),
            componentType: b.component_type || 'ToolCallCard',
            importanceScore: typeof b.importance_score === 'number' ? b.importance_score : 0.5,
            summary: b.summary || '',
            stage: typeof b.stage === 'number' ? b.stage : 1,
        }));
    }
    catch (err) {
        console.warn(`[extraction] Batch ${batchNum}: failed to parse JSON`, err);
        return [];
    }
}
// Final consolidation: send all extracted blocks to LLM for narrative ordering
async function consolidateBlocks(allBlocks, json, apiKey, isDeepSeek) {
    console.log(`[extraction] Reduce phase: consolidating ${allBlocks.length} blocks from all batches`);
    // Build block summary — sort by message index to preserve original order
    const blockSummary = allBlocks
        .sort((a, b) => parseInt(a.groupId) - parseInt(b.groupId))
        .map(b => `[msg#${b.groupId}] ${b.componentType} stage=${b.stage} score=${b.importanceScore} "${b.summary}"`)
        .join('\n');
    const config = getConfig();
    const template = config.extractionPrompt || DEFAULT_EXTRACTION_PROMPT;
    const prompt = template
        .replace(/\{\{MODE\}\}/g, json.chat.mode || '')
        .replace(/\{\{AGENT_MODE\}\}/g, json.chat.agentMode || '')
        .replace(/\{\{SECONDS\}\}/g, String(Math.round(json.chat.seconds || 0)))
        .replace(/\{\{MSG_COUNT\}\}/g, String(json.chat.msg_count || 0))
        .replace(/\{\{TOKENS\}\}/g, String(json.chat.tokens || 0))
        .replace(/\{\{MESSAGE_SUMMARY\}\}/g, `以下是从所有批次中提取的 ${allBlocks.length} 个步骤（按原始消息顺序排列）：\n\n${blockSummary}\n\n请根据以上信息，应用叙事连贯性和类型多样性原则，输出最终的卡片序列。`);
    console.log(`[extraction] Calling LLM for final consolidation (${allBlocks.length} blocks, ~${prompt.length} chars)`);
    const response = await callLLM(apiKey, prompt, isDeepSeek, 8192);
    return parseExtractionResponse(response, json);
}
// ---- LLM API call ----
async function callLLM(apiKey, prompt, isDeepSeek, maxTokens = 8192) {
    const endpoint = isDeepSeek
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    const model = isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini';
    console.log(`[extraction] Calling ${isDeepSeek ? 'DeepSeek' : 'OpenAI'} API (${model}, max_tokens=${maxTokens})...`);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: '你是一位多智能体工作流分析专家。只输出合法的 JSON 数组，不要有任何额外文字。' },
                { role: 'user', content: prompt },
            ],
            temperature: 0.1,
            max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`LLM API error: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}
// ---- Parse final response & assemble blocks ----
function parseExtractionResponse(response, json) {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
    const cleanJson = (jsonMatch[1] || response).trim();
    try {
        const blocks = JSON.parse(cleanJson);
        if (!Array.isArray(blocks))
            throw new Error('Not an array');
        console.log(`[extraction] Final consolidation returned ${blocks.length} blocks`);
        const regularBlocks = [];
        let summaryFindings = null;
        for (const b of blocks) {
            if (b.context_id === '_summary_' || b.message_index === '_summary_' || b.component_type === 'SummaryCard') {
                if (b.findings && Array.isArray(b.findings)) {
                    summaryFindings = b.findings;
                }
            }
            else {
                // Accept message_index, context_id, or group_id
                const id = b.message_index ?? b.context_id ?? b.group_id ?? '';
                regularBlocks.push({
                    groupId: String(id),
                    componentType: b.component_type || 'ToolCallCard',
                    importanceScore: typeof b.importance_score === 'number' ? b.importance_score : 0.5,
                    summary: b.summary || '',
                    stage: typeof b.stage === 'number' ? b.stage : 1,
                });
            }
        }
        const curatedBlocks = assembleBlocks(json, regularBlocks);
        const maxStage = regularBlocks.length > 0
            ? Math.max(...regularBlocks.map(b => b.stage))
            : 1;
        if (summaryFindings && summaryFindings.length > 0) {
            curatedBlocks.push(createSummaryBlock(summaryFindings, json, maxStage));
        }
        else if (!regularBlocks.some(b => b.componentType === 'SummaryCard')) {
            curatedBlocks.push(createSummaryBlock(generateFallbackFindings(json, regularBlocks), json, maxStage));
        }
        return curatedBlocks;
    }
    catch (err) {
        console.error('[extraction] Failed to parse consolidation response:', err);
        throw err;
    }
}
function createSummaryBlock(findings, json, maxStage) {
    return {
        id: 'summary-' + Date.now(),
        groupIds: ['_summary_'],
        componentType: 'SummaryCard',
        importanceScore: 1.0,
        summary: `${json.chat.agentMode || '智能体'} 工作流执行总结`,
        stage: maxStage,
        content: { findings },
    };
}
function generateFallbackFindings(json, results) {
    const stagesCovered = new Set(results.map(r => r.stage));
    const maxStage = stagesCovered.size > 0 ? Math.max(...stagesCovered) : 1;
    const coveredNames = [...stagesCovered].sort((a, b) => a - b).map(s => `阶段${s}`);
    return [
        `执行模式: ${json.chat.mode || 'unknown'}, 代理类型: ${json.chat.agentMode || 'unknown'}`,
        `总耗时: ${Math.round(json.chat.seconds || 0)}秒, 总消息数: ${json.chat.msg_count || 0}, Token 消耗: ${json.chat.tokens || 0}`,
        `覆盖阶段 (${stagesCovered.size}/${maxStage}): ${coveredNames.join(' → ')}`,
        `识别关键步骤: ${results.length} 个`,
        stagesCovered.size >= maxStage ? '分析流程已覆盖所有识别到的阶段' : `分析覆盖了 ${stagesCovered.size}/${maxStage} 个阶段`,
    ];
}
// Enhanced deterministic: adds SummaryCard when LLM is unavailable
function enhanceDeterministic(json) {
    const results = classifyDeterministic(json);
    const blocks = assembleBlocks(json, results);
    console.log(`[extraction] Deterministic classified ${results.length} messages into ${blocks.length} blocks`);
    const stagesCovered = new Set(blocks.map(b => b.stage));
    const maxStage = stagesCovered.size > 0 ? Math.max(...stagesCovered) : 1;
    if (stagesCovered.size < Math.min(maxStage, 5)) {
        console.log(`[extraction] Warning: only ${stagesCovered.size}/${maxStage} stages covered`);
    }
    const findings = generateFallbackFindings(json, results);
    blocks.push(createSummaryBlock(findings, json, maxStage));
    return blocks;
}
//# sourceMappingURL=llm.js.map