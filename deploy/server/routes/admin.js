import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from './auth.js';
import { getAllRuns, getRunById, createRun, updateRun, deleteRun, updateConfig as updateConfigDb, getPublicConfig, DEFAULT_EXTRACTION_PROMPT, } from '../db/index.js';
import { classifyDeterministic, assembleBlocks } from '../extraction/deterministic.js';
import { BATCH_PROMPT } from '../extraction/llm.js';
export const adminRouter = Router();
adminRouter.use(requireAdmin);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});
// POST /admin/api/runs — upload
adminRouter.post('/runs', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '请上传JSON文件' } });
            return;
        }
        const rawText = req.file.buffer.toString('utf-8');
        let pipelineJson;
        try {
            pipelineJson = JSON.parse(rawText);
        }
        catch {
            res.status(422).json({ success: false, error: { code: 'INVALID_JSON', message: 'JSON格式错误，请检查文件' } });
            return;
        }
        if (!pipelineJson.messages || !Array.isArray(pipelineJson.messages)) {
            res.status(422).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'JSON缺少messages字段' } });
            return;
        }
        if (!pipelineJson.chat || !pipelineJson.chat.id) {
            res.status(422).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'JSON缺少chat元数据' } });
            return;
        }
        const id = uuidv4();
        const title = pipelineJson.chat.name || 'Untitled Run';
        const now = new Date().toISOString();
        const results = classifyDeterministic(pipelineJson);
        const blocks = assembleBlocks(pipelineJson, results);
        createRun({
            id,
            title,
            rawJson: rawText,
            curatedBlocks: JSON.stringify(blocks),
            status: 'draft',
            agentMode: pipelineJson.chat.agentMode || '',
            executionMode: pipelineJson.chat.mode || '',
            durationSeconds: pipelineJson.chat.seconds || 0,
            tokenCount: pipelineJson.chat.tokens || 0,
            createdAt: now,
            updatedAt: now,
        });
        res.status(201).json({ success: true, data: { id, blockCount: blocks.length } });
    }
    catch (err) {
        console.error('[admin] Upload error:', err);
        res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: '服务器错误' } });
    }
});
// GET /admin/api/config
adminRouter.get('/config', (_req, res) => {
    const publicCfg = getPublicConfig();
    res.json({
        success: true,
        data: {
            config: {
                ...publicCfg,
                batchPrompt: BATCH_PROMPT,
                defaultExtractionPrompt: DEFAULT_EXTRACTION_PROMPT,
            },
        },
    });
});
// PUT /admin/api/config
adminRouter.put('/config', (req, res) => {
    const { deepseekApiKey, openaiApiKey, preferredModel } = req.body;
    const updates = {};
    if (typeof deepseekApiKey === 'string')
        updates.deepseekApiKey = deepseekApiKey;
    if (typeof openaiApiKey === 'string')
        updates.openaiApiKey = openaiApiKey;
    if (preferredModel === 'deepseek' || preferredModel === 'openai')
        updates.preferredModel = preferredModel;
    updateConfigDb(updates);
    res.json({ success: true, data: { config: getPublicConfig() } });
});
// GET /admin/api/runs
adminRouter.get('/runs', (_req, res) => {
    const runs = getAllRuns().map(r => ({
        id: r.id,
        title: r.title,
        agentMode: r.agentMode,
        executionMode: r.executionMode,
        durationSeconds: r.durationSeconds,
        blockCount: JSON.parse(r.curatedBlocks || '[]').length,
        status: r.status,
        createdAt: r.createdAt,
    }));
    res.json({ success: true, data: { runs } });
});
// GET /admin/api/runs/:id
adminRouter.get('/runs/:id', (req, res) => {
    const row = getRunById(req.params.id);
    if (!row) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '运行记录不存在' } });
        return;
    }
    res.json({
        success: true,
        data: {
            run: {
                id: row.id,
                title: row.title,
                blocks: JSON.parse(row.curatedBlocks || '[]'),
                rawJson: JSON.parse(row.rawJson),
                status: row.status,
                agentMode: row.agentMode,
                executionMode: row.executionMode,
                durationSeconds: row.durationSeconds,
                tokenCount: row.tokenCount,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            },
        },
    });
});
// PUT /admin/api/runs/:id
adminRouter.put('/runs/:id', (req, res) => {
    const { blocks, status } = req.body;
    const updates = {};
    if (blocks)
        updates.curatedBlocks = JSON.stringify(blocks);
    if (status)
        updates.status = status;
    const ok = updateRun(req.params.id, updates);
    if (!ok) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '运行记录不存在' } });
        return;
    }
    res.json({ success: true });
});
// DELETE /admin/api/runs/:id
adminRouter.delete('/runs/:id', (req, res) => {
    const ok = deleteRun(req.params.id);
    if (!ok) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '运行记录不存在' } });
        return;
    }
    res.json({ success: true });
});
//# sourceMappingURL=admin.js.map