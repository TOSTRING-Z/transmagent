import { Router } from 'express';
import { getPublishedRuns, getRunById } from '../db/index.js';
export const runsRouter = Router();
// GET /api/runs
runsRouter.get('/runs', (_req, res) => {
    const rows = getPublishedRuns().map(r => ({
        id: r.id,
        title: r.title,
        agentMode: r.agentMode,
        executionMode: r.executionMode,
        durationSeconds: r.durationSeconds,
        blockCount: JSON.parse(r.curatedBlocks || '[]').length,
        status: r.status,
        createdAt: r.createdAt,
    }));
    const response = { success: true, data: { runs: rows } };
    res.json(response);
});
// GET /api/runs/:id
runsRouter.get('/runs/:id', (req, res) => {
    const row = getRunById(req.params.id);
    if (!row || row.status !== 'published') {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '运行记录不存在' } });
        return;
    }
    const run = {
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
    };
    const response = { success: true, data: { run } };
    res.json(response);
});
//# sourceMappingURL=runs.js.map