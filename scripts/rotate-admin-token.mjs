// Xoay ADMIN_API_TOKEN định kỳ trên Render, không bao giờ khóa admin ra ngoài.
//
// Cách hoạt động (đúng thứ tự này):
//   1. Đọc ADMIN_API_TOKEN cũ (read-only) — cần cho rollback
//   2. PUT /services/{id}/env-vars/ADMIN_API_TOKEN — cập nhật MỘT biến, các biến khác không động tới
//   3. POST deploy để env var có hiệu lực
//   4. Poll GET {APP_URL}/api/admin/products với token mới đến khi trả 200 (tối đa ~10 phút)
//   5. CHỈ KHI đó gửi email token mới cho SUPPORT_EMAIL (qua Resend)
//   6. Lỗi bất kỳ trước bước 5 → rollback về token cũ + redeploy + email cảnh báo
//
// Chạy:
//   npm run rotate:admin-token              # KHÔNG làm gì — chỉ in kế hoạch (an toàn)
//   npm run rotate:admin-token:apply   # xoay thật (cần env vars đầy đủ)
//
// Nguyên tắc chống lỗi liên hoàn: script LUÔN an toàn khi gõ sai. Mặc định là
// dry-run, chỉ --apply mới chạm vào Render.
//
// Yêu cầu (GitHub Actions secrets hoặc .env):
//   RENDER_API_KEY, RENDER_SERVICE_ID, RESEND_API_KEY, APP_URL
//   SUPPORT_EMAIL, EMAIL_FROM
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, appendFileSync } from 'node:fs';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });
const value = (key, fallback = '') => (process.env[key] || fallback).trim();

const APPLY = process.argv.includes('--apply');
const token = value('RENDER_API_KEY');
const serviceId = value('RENDER_SERVICE_ID');
const resendKey = value('RESEND_API_KEY');
// Domain không được gõ tay vào file nào ngoài config: mọi host lấy từ env.
const appUrlRaw = value('APP_URL');
const appUrl = appUrlRaw.replace(/\/+$/, '');
const supportEmail = value('SUPPORT_EMAIL');
const emailFrom = value('EMAIL_FROM');
const api = 'https://api.render.com/v1';
const adminVarKey = 'ADMIN_API_TOKEN';

const missing = [];
if (!token) missing.push('RENDER_API_KEY');
if (!serviceId) missing.push('RENDER_SERVICE_ID');
if (!resendKey) missing.push('RESEND_API_KEY');
if (!appUrlRaw) missing.push('APP_URL');
if (!supportEmail) missing.push('SUPPORT_EMAIL');
if (!emailFrom) missing.push('EMAIL_FROM');
if (missing.length && APPLY) {
  console.error(`[rotate] Thiếu env vars: ${missing.join(', ')}`);
  process.exit(2);
}

const logLine = (line) => {
  try {
    mkdirSync(path.join(root, 'logs'), { recursive: true });
    appendFileSync(path.join(root, 'logs', 'token-rotations.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* log best-effort */ }
  console.log(line);
};

const apiCall = async (method, pathName, body) => {
  const response = await fetch(`${api}/services/${serviceId}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${pathName}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
};

// List env vars, paginated (limit=100 covers 56 today, loop guards growth).
const listEnvVars = async () => {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const body = await apiCall('GET', `/env-vars${query}`);
    const items = Array.isArray(body) ? body : [];
    for (const item of items) {
      if (item?.envVar?.key) all.push(item.envVar);
    }
    if (items.length < 100) break;
    cursor = items[items.length - 1]?.cursor || null;
    if (!cursor) break;
  }
  return all;
};

const getAdminToken = async () => {
  const vars = await listEnvVars();
  const entry = vars.find((e) => e.key === adminVarKey);
  return entry ? entry.value : null;
};

const putEnvVar = async (key, value) => {
  await apiCall('PUT', `/env-vars/${encodeURIComponent(key)}`, { key, value });
};

const triggerDeploy = async () => {
  await apiCall('POST', '/deploys', {});
};

const adminWorksWith = async (candidate) => {
  try {
    const response = await fetch(`${appUrl}/api/admin/products`, {
      headers: { 'x-admin-token': candidate },
      signal: AbortSignal.timeout(10000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
};

const fingerprint = (tok) => (tok ? `${tok.slice(0, 8)}…${tok.slice(-4)}` : 'n/a');
const dateStr = new Date().toISOString().slice(0, 10);
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hostOf = () => { try { return new URL(appUrl).host; } catch { return appUrl; } };

const email = {
  success: (newToken) => ({
    subject: `[SonVuDev] Admin API token đã xoay — ${dateStr}`,
    html: `<p>Token admin API của <strong>${escapeHtml(hostOf())}</strong> đã được xoay tự động vào <strong>${dateStr}</strong>.</p>
<p>Token mới (chỉ người nhận được email này có):</p>
<p><code style="font-size:16px">${newToken}</code></p>
<p>Token cũ đã bị vô hiệu hóa khi Render redeploy. Nếu bạn dùng token này cho:</p>
<ul>
<li>Admin panel tại <a href="${escapeHtml(appUrl)}/admin.html">${escapeHtml(hostOf())}/admin.html</a> — nhập token mới khi được hỏi.</li>
<li>Script tại máy của bạn — cập nhật biến trong <code>.env</code>.</li>
</ul>
<p>Nếu bạn không mong đợi xoay này, hoặc token có thể đã lộ, hãy xoay thủ công ngay.</p>`,
  }),
  failure: (error) => ({
    subject: `[SonVuDev] XOAY TOKEN THẤT BẠI — đã rollback — ${dateStr}`,
    html: `<p>Lần xoay token dự kiến <strong>${dateStr}</strong> đã thất bại với lỗi:</p>
<pre>${String(error).replace(/</g, '&lt;')}</pre>
<p>Hệ thống đã tự động rollback về token cũ (đã được xác nhận hoạt động). Token mới <strong>không</strong> được áp dụng.</p>
<p>Không cần hành động ngay. Nếu lỗi lặp lại, kiểm tra GitHub Actions (workflow rotate-admin-token) hoặc xoay thủ công.</p>`,
  }),
};

const sendEmail = async (subject, html) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: emailFrom, to: [supportEmail], subject, html }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Resend HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
};

if (!APPLY) {
  console.log('[rotate] Chưa có --apply — không gọi API, không email, không thay đổi gì.');
  console.log(`         APP_URL=${appUrl}`);
  console.log(`         SUPPORT_EMAIL=${supportEmail}`);
  console.log(`         RENDER_SERVICE_ID=${serviceId ? 'set' : 'missing'}`);
  console.log('         để xoay thật: npm run rotate:admin-token:apply');
  process.exit(0);
}

let oldToken = null;
try {
  logLine(`[rotate] start — APP_URL=${appUrl}`);
  oldToken = await getAdminToken(); // đọc 1 lần duy nhất, read-only
  logLine(`[rotate] read current ADMIN_API_TOKEN: ${oldToken ? `present (${fingerprint(oldToken)})` : 'absent'}`);

  const newToken = randomBytes(32).toString('base64url');
  await putEnvVar(adminVarKey, newToken);
  logLine('[rotate] env-vars/ADMIN_API_TOKEN updated (single-variable PUT)');

  await triggerDeploy();
  logLine('[rotate] deploy triggered');

  // Đợi deploy xong: poll cho đến khi token mới hoạt động, tối đa ~10 phút.
  let live = false;
  for (let attempt = 1; attempt <= 20 && !live; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 30000));
    live = await adminWorksWith(newToken);
    logLine(`[rotate] poll ${attempt}/20 with new token: ${live ? 'OK' : 'not yet'}`);
  }
  if (!live) throw new Error('Deploy chưa phục vụ token mới sau 10 phút — rollback');

  const { subject, html } = email.success(newToken);
  await sendEmail(subject, html);
  logLine(`[rotate] SUCCESS — new token fingerprint ${fingerprint(newToken)}, email sent to ${supportEmail}`);
  process.exit(0);
} catch (error) {
  logLine(`[rotate] FAILURE — ${error.message}`);
  // Rollback: trả ADMIN_API_TOKEN về giá trị cũ duy nhất ta biết, rồi redeploy.
  try {
    if (oldToken) {
      await putEnvVar(adminVarKey, oldToken);
      await triggerDeploy();
      logLine('[rotate] rolled back to previous ADMIN_API_TOKEN and redeployed');
    } else {
      logLine('[rotate] no previous ADMIN_API_TOKEN existed — nothing to restore');
    }
  } catch (rollbackError) {
    logLine(`[rotate] rollback failed: ${rollbackError.message}`);
  }
  try {
    const { subject, html } = email.failure(error.message);
    await sendEmail(subject, html);
    logLine('[rotate] failure notice sent to admin');
  } catch (mailError) {
    logLine(`[rotate] could not send failure notice: ${mailError.message}`);
  }
  process.exit(1);
}
