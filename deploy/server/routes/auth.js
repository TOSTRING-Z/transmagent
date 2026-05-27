import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyPassword } from '../middleware/auth.js';
import { getAdminByUsername } from '../db/index.js';
export const authRouter = Router();
const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, error: { code: 'RATE_LIMITED', message: '登录尝试过多，请稍后再试' } },
});
export function requireAdmin(req, res, next) {
    if (req.session.isAdmin) {
        next();
    }
    else {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } });
    }
}
authRouter.post('/login', loginLimiter, (req, res) => {
    const { password } = req.body;
    if (!password) {
        res.status(400).json({ success: false, error: { code: 'MISSING_PASSWORD', message: '请输入密码' } });
        return;
    }
    const admin = getAdminByUsername('admin');
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
        res.status(401).json({ success: false, error: { code: 'INVALID_PASSWORD', message: '密码错误' } });
        return;
    }
    req.session.isAdmin = true;
    res.json({ success: true, data: { redirect: '/admin/dashboard' } });
});
authRouter.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});
authRouter.get('/check', (req, res) => {
    res.json({ success: true, data: { authenticated: !!req.session.isAdmin } });
});
//# sourceMappingURL=auth.js.map