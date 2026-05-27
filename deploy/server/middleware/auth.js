import bcrypt from 'bcryptjs';
import { createAdmin, adminCount } from '../db/index.js';
const SALT_ROUNDS = 12;
export function hashPassword(password) {
    return bcrypt.hashSync(password, SALT_ROUNDS);
}
export function verifyPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}
export function seedAdmin() {
    if (adminCount() === 0) {
        const password = process.env.ADMIN_PASSWORD || generateRandomPassword();
        const hash = hashPassword(password);
        createAdmin({ id: 1, username: 'admin', passwordHash: hash });
        console.log(`[setup] Admin account created. Username: admin, Password: ${password}`);
        if (!process.env.ADMIN_PASSWORD) {
            console.log('[setup] Set ADMIN_PASSWORD env var to choose your own password.');
        }
    }
}
function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
//# sourceMappingURL=auth.js.map