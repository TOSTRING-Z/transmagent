import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
function readJSON(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    }
    catch { /* ignore */ }
    return fallback;
}
function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
// ---- Runs CRUD ----
export function getAllRuns() {
    return readJSON(RUNS_FILE, []);
}
export function getPublishedRuns() {
    return getAllRuns().filter(r => r.status === 'published');
}
export function getRunById(id) {
    return getAllRuns().find(r => r.id === id);
}
export function createRun(run) {
    const runs = getAllRuns();
    runs.unshift(run);
    writeJSON(RUNS_FILE, runs);
}
export function updateRun(id, updates) {
    const runs = getAllRuns();
    const index = runs.findIndex(r => r.id === id);
    if (index === -1)
        return false;
    runs[index] = { ...runs[index], ...updates, updatedAt: new Date().toISOString() };
    writeJSON(RUNS_FILE, runs);
    return true;
}
export function deleteRun(id) {
    const runs = getAllRuns();
    const filtered = runs.filter(r => r.id !== id);
    if (filtered.length === runs.length)
        return false;
    writeJSON(RUNS_FILE, filtered);
    return true;
}
// ---- Admin ----
export function getAdmins() {
    return readJSON(ADMINS_FILE, []);
}
export function getAdminByUsername(username) {
    return getAdmins().find(a => a.username === username);
}
export function createAdmin(admin) {
    const admins = getAdmins();
    admins.push(admin);
    writeJSON(ADMINS_FILE, admins);
}
export function adminCount() {
    return getAdmins().length;
}
// ---- Config ----
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const DEFAULT_EXTRACTION_PROMPT = `你是多智能体工作流日志整理师。以下是从执行日志各批次提取的步骤列表（垃圾已在提取阶段滤除），你的任务是：合并连续重复步骤，优化中文摘要，确保叙事连贯。

=== 合并原则 ===
- 连续2条以上相同命令+相同结果 → 合并为1条（summary标注"×N次"）
- 错误重试链（同一命令前条失败后条成功）→ 只保留成功的
- 其余步骤全部保留，不做删减

=== 组件类型（保持与原分类一致） ===
ConversationBubble | ToolCallCard | ToolResultCard | CodeBlock | WorkflowStage | FilePreview | ThinkingBlock | SummaryCard

=== 阶段编号 ===
沿用原 stage 值不变，无需重新推断。

=== 输出 ===
纯 JSON 数组（严禁 markdown 包装），最后一条必须是 SummaryCard：

[{"message_index":序号,"component_type":"类型","importance_score":0.0-1.0,"summary":"中文描述","stage":阶段号}]

SummaryCard 格式:
{"message_index":"_summary_","component_type":"SummaryCard","importance_score":1.0,"summary":"工作流执行总结","stage":最后阶段号,"findings":["目标/问题","各阶段关键产出","最终结论","统计: 模式={{MODE}} 代理={{AGENT_MODE}} 耗时={{SECONDS}}秒 消息={{MSG_COUNT}} Token={{TOKENS}}"]}

=== 元数据 ===
模式={{MODE}} | 代理={{AGENT_MODE}} | 耗时={{SECONDS}}秒 | 消息数={{MSG_COUNT}} | Token={{TOKENS}}

=== 待整理的步骤 ===
{{MESSAGE_SUMMARY}}`;
const DEFAULT_CONFIG = {
    deepseekApiKey: '',
    openaiApiKey: '',
    preferredModel: 'deepseek',
    extractionPrompt: '',
    updatedAt: '',
};
export function getConfig() {
    return readJSON(CONFIG_FILE, DEFAULT_CONFIG);
}
export function updateConfig(updates) {
    const current = getConfig();
    const merged = { ...current, ...updates, updatedAt: new Date().toISOString() };
    writeJSON(CONFIG_FILE, merged);
    return merged;
}
function maskKey(key) {
    if (!key)
        return '';
    if (key.length < 8)
        return '****';
    return key.slice(0, 6) + '****' + key.slice(-4);
}
export function getPublicConfig() {
    const config = getConfig();
    return {
        preferredModel: config.preferredModel,
        hasDeepseekKey: config.deepseekApiKey.length > 0,
        hasOpenaiKey: config.openaiApiKey.length > 0,
        deepseekKeyMasked: maskKey(config.deepseekApiKey),
        openaiKeyMasked: maskKey(config.openaiApiKey),
        extractionPrompt: config.extractionPrompt || DEFAULT_EXTRACTION_PROMPT,
        hasCustomPrompt: (config.extractionPrompt || '').length > 0,
    };
}
//# sourceMappingURL=index.js.map