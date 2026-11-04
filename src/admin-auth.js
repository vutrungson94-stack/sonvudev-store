// Admin authentication with minimal RBAC and expiry, fully backward compatible.
//
// Previously there was only one token (ADMIN_API_TOKEN): it had no expiry, no role,
// and no name for tracing who did what. Existing tests use that token, so the default
// behavior must stay exactly the same: a single token remains an unrestricted admin token with no expiry.
//
// Optional extension (not required in order to run):
//   ADMIN_API_TOKENS="owner:tok1:admin, staff:tok2:viewer@2027-01-01"
//   - Each entry: [name:]token[:role][@YYYY-MM-DD]
//   - role: admin (read+write) or viewer (GET only). Missing role means admin.
//   - @date expires at 23:59:59Z on that day; an expired token is rejected as unknown.
//   - req.admin = { name, role } for audit logging.
import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
};

export function parseAdminTokens({ primary = '', extra = '' } = {}) {
  const out = [];
  if (primary && String(primary).trim()) {
    out.push({ name: 'primary', token: String(primary).trim(), role: 'admin', expiresAt: null });
  }
  for (const raw of String(extra || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    // Split the expiry suffix before anything else: token@2027-01-01
    let body = raw;
    let expiresAt = null;
    const at = body.lastIndexOf('@');
    if (at > 0) {
      const dateText = body.slice(at + 1).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        expiresAt = new Date(`${dateText}T23:59:59.999Z`);
        if (Number.isNaN(expiresAt.getTime())) expiresAt = null;
        else body = body.slice(0, at).trim();
      }
    }
    const parts = body.split(':').map((s) => s.trim());
    let name = 'extra';
    let token = '';
    let role = 'admin';
    if (parts.length === 1) {
      token = parts[0];
    } else if (parts.length === 2) {
      // name:token or token:role
      if (['admin', 'viewer'].includes(parts[1].toLowerCase())) {
        token = parts[0];
        role = parts[1].toLowerCase();
      } else {
        name = parts[0] || 'extra';
        token = parts[1];
      }
    } else {
      name = parts[0] || 'extra';
      token = parts[1];
      if (['admin', 'viewer'].includes((parts[2] || '').toLowerCase())) role = parts[2].toLowerCase();
    }
    if (!token) continue;
    out.push({ name, token, role, expiresAt });
  }
  return out;
}

export const isExpired = (entry, now = Date.now()) =>
  Boolean(entry.expiresAt && Number.isFinite(entry.expiresAt.getTime()) && now > entry.expiresAt.getTime());

export function matchAdminToken(supplied, entries, now = Date.now()) {
  if (!supplied) return null;
  for (const entry of entries) {
    if (isExpired(entry, now)) continue;
    if (safeEqual(supplied, entry.token)) return entry;
  }
  return null;
}
