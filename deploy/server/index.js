import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { runsRouter } from './routes/runs.js';
import { adminRouter } from './routes/admin.js';
import { seedAdmin } from './middleware/auth.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3006', 10);
const isProduction = process.env.NODE_ENV === 'production';
// Seed initial admin account
seedAdmin();
// CORS — only needed in development (Vite dev server on different port)
if (!isProduction) {
    app.use(cors({
        origin: ['http://localhost:5173', 'http://localhost:5174'],
        credentials: true,
    }));
}
app.use(express.json({ limit: '10mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'transmagent-workflow-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
    },
}));
// API routes
app.use('/api', runsRouter);
app.use('/admin', authRouter);
app.use('/admin/api', adminRouter);
// Serve static files in production
if (isProduction) {
    const publicDir = path.resolve(__dirname, '..', 'public');
    app.use(express.static(publicDir));
    // Admin SPA fallback
    app.get('/admin/*', (_req, res) => {
        res.sendFile(path.join(publicDir, 'admin', 'index.html'));
    });
    // Viewer SPA fallback
    app.get('*', (_req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
    });
}
app.listen(PORT, () => {
    console.log(`[server] TransMAgent Workflow Viewer running on http://localhost:${PORT}`);
    console.log(`[server] Admin: http://localhost:${PORT}/admin/login`);
    console.log(`[server] Viewer: http://localhost:${PORT}/`);
    console.log(`[server] Mode: ${isProduction ? 'production' : 'development'}`);
});
export default app;
//# sourceMappingURL=index.js.map