import crypto from 'node:crypto';
import { query } from '../db.js';

const COOKIE_NAME = 'admin_session';

function sign(value) {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

export async function ensureDefaultAdmin() {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return;
  await query(
    `INSERT INTO admin_users (username, password_hash, role, is_active)
     VALUES ($1, $2, 'admin', TRUE)
     ON CONFLICT (username) DO NOTHING`,
    [process.env.ADMIN_USERNAME, hashPassword(process.env.ADMIN_PASSWORD)]
  );
}

export async function authenticateAdmin(username, password) {
  const res = await query('SELECT id, username, password_hash, is_active FROM admin_users WHERE username = $1', [username]);
  const user = res.rows[0];
  if (!user || !user.is_active) return null;
  if (user.password_hash !== hashPassword(password)) return null;
  return { id: user.id, username: user.username };
}

export function createAdminSessionCookie(adminUser) {
  const payload = JSON.stringify({ id: adminUser.id, username: adminUser.username, exp: Date.now() + 1000 * 60 * 60 * 24 });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = sign(encoded);
  return `${COOKIE_NAME}=${encoded}.${sig}; HttpOnly; Path=/; SameSite=Lax`;
}

export function parseAdminSession(req) {
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE_NAME}=`));
  if (!token) return null;
  const value = token.split('=')[1];
  const [encoded, sig] = value.split('.');
  if (!encoded || !sig || sign(encoded) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function logAdminAction(adminUserId, action, entityType = null, entityId = null, payload = {}) {
  await query(
    `INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [adminUserId, action, entityType, entityId, JSON.stringify(payload)]
  );
}
