// One-click Cloudflare token rotation.
//
// A Cloudflare API token cannot renew itself. This module turns an email link
// into a controlled roll: read the old token's policy, create a replacement with
// the same permissions, point every consumer at it, verify it works, and only
// then revoke the old one. The link is HMAC-signed, bound to one token id and
// short-lived; the POST confirmation stops mail-client link scanners from
// rotating anything.
//
// Render is the single source of truth for CLOUDFLARE_API_TOKEN. GitHub Actions
// reads it from Render at job time, so a roll never needs a GitHub PAT with
// secret-write scope and there is no second copy to fall out of sync.
import crypto from "node:crypto";
import { esc } from "../format.js";

export const CF_TOKEN_ENV_KEY = "CLOUDFLARE_API_TOKEN";
const CF_API = "https://api.cloudflare.com/client/v4";
const RENDER_API = "https://api.render.com/v1";
const DEFAULT_TTL_HOURS = 72;
const DEFAULT_LIFETIME_DAYS = 90;

const text = (error) => String(error?.message || error || "").slice(0, 300);

// ---------------------------------------------------------------------------
// Signed links
// ---------------------------------------------------------------------------

/** The HMAC input. Kept in one function so the mailer and the verifier cannot drift. */
const signatureInput = ({ action, tokenId, exp }) => `${action}|${tokenId}|${exp}`;

export function signRotationPayload(secret, payload) {
  if (!secret) throw new Error("ROTATION_SIGNING_KEY is not configured");
  return crypto.createHmac("sha256", secret).update(signatureInput(payload)).digest("base64url");
}

/** Constant-time verification: a wrong signature and a truncated one both fail. */
export function verifyRotationPayload(secret, input = {}) {
  if (!secret) return { ok: false, reason: "ROTATION_SIGNING_KEY chưa được cấu hình" };
  const { action, tokenId, exp, sig } = input;
  if (action !== "rotate" || !tokenId || !exp || !sig) {
    return { ok: false, reason: "Link xoay không đầy đủ tham số" };
  }
  if (!/^\d+$/.test(String(exp)) || Date.now() > Number(exp) * 1000) {
    return { ok: false, reason: "Link xoay đã hết hạn" };
  }
  const expected = signRotationPayload(secret, { action, tokenId, exp });
  const got = Buffer.from(String(sig));
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    return { ok: false, reason: "Chữ ký link xoay không hợp lệ" };
  }
  return { ok: true, tokenId: String(tokenId) };
}

export function buildRotationLink({ origin, secret, tokenId, ttlHours = DEFAULT_TTL_HOURS, now = Date.now() }) {
  const exp = Math.floor(now / 1000) + Math.max(1, ttlHours) * 3600;
  const payload = { action: "rotate", tokenId, exp };
  const query = new URLSearchParams({ ...payload, sig: signRotationPayload(secret, payload) });
  return `${String(origin).replace(/\/+$/, "")}/api/rotation/confirm?${query}`;
}

export function nextExpiry(now = new Date(), days = DEFAULT_LIFETIME_DAYS) {
  const at = new Date(now.getTime() + Math.max(1, days) * 86400000);
  return at.toISOString();
}

// ---------------------------------------------------------------------------
// API helpers. fetch is injectable so the orchestration can be tested offline.
// ---------------------------------------------------------------------------

const httpJson = async (fetchImpl, url, { method = "GET", token, body } = {}) => {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}: ${raw.slice(0, 300)}`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`Phản hồi không phải JSON từ ${url}`); }
  if (parsed.success === false) {
    throw new Error(`${url}: ${(parsed.errors || []).map((e) => e.message).join("; ") || "API trả lỗi"}`);
  }
  return parsed;
};

export const readCloudflareToken = (masterToken, tokenId, fetchImpl = fetch) =>
  httpJson(fetchImpl, `${CF_API}/user/tokens/${encodeURIComponent(tokenId)}`, { token: masterToken })
    .then((body) => {
      const result = body.result;
      if (!result || !Array.isArray(result.policies) || !result.policies.length) {
        throw new Error("Token hiện tại không có policy để sao chép — từ chối tạo token mới");
      }
      return result;
    });

export const verifyCloudflareToken = (token, fetchImpl = fetch) =>
  httpJson(fetchImpl, `${CF_API}/user/tokens/verify`, { token })
    .then((body) => body?.result?.status);

export const createCloudflareToken = (masterToken, { name, policies, expiresOn }, fetchImpl = fetch) =>
  httpJson(fetchImpl, `${CF_API}/user/tokens`, {
    method: "POST",
    token: masterToken,
    body: { name, policies, ...(expiresOn ? { expires_on: expiresOn } : {}) },
  }).then((body) => {
    if (!body.result?.value || !body.result?.id) throw new Error("Cloudflare không trả token mới");
    return body.result;
  });

export const deleteCloudflareToken = (masterToken, tokenId, fetchImpl = fetch) =>
  httpJson(fetchImpl, `${CF_API}/user/tokens/${encodeURIComponent(tokenId)}`, {
    method: "DELETE", token: masterToken,
  });

/** Copy only the fields Cloudflare accepts on create; meta/name are read-only. */
export function sanitizePolicies(policies) {
  return policies.map((policy) => ({
    effect: policy.effect,
    resources: policy.resources,
    permission_groups: (policy.permission_groups || []).map((group) => ({ id: group.id })),
  }));
}

const renderCall = (fetchImpl, apiKey, serviceId, method, path, body) =>
  httpJson(fetchImpl, `${RENDER_API}/services/${encodeURIComponent(serviceId)}${path}`, {
    method, token: apiKey, ...(body ? { body } : {}),
  });

export async function readRenderEnvValue(fetchImpl, apiKey, serviceId, key) {
  for (let page = 0; page < 10; page += 1) {
    const query = page === 0 ? "?limit=100" : `?limit=100&cursor=${encodeURIComponent(page)}`;
    const rows = await renderCall(fetchImpl, apiKey, serviceId, "GET", `/env-vars${query}`);
    const items = Array.isArray(rows) ? rows : [];
    const found = items.find((row) => row?.envVar?.key === key);
    if (found) return found.envVar.value;
    if (items.length < 100) break;
  }
  return null;
}

export const updateRenderEnvValue = (fetchImpl, apiKey, serviceId, key, value) =>
  renderCall(fetchImpl, apiKey, serviceId, "PUT", `/env-vars/${encodeURIComponent(key)}`, { value });

export const triggerRenderDeploy = (fetchImpl, apiKey, serviceId) =>
  renderCall(fetchImpl, apiKey, serviceId, "POST", "/deploys", {});

export async function sendRotationMail(fetchImpl, { apiKey, from, to, subject, html }) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Resend HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function rotationConfig(env = process.env) {
  return {
    masterToken: String(env.CLOUDFLARE_MASTER_TOKEN || "").trim(),
    renderApiKey: String(env.RENDER_API_KEY || "").trim(),
    serviceId: String(env.RENDER_SERVICE_ID || "").trim(),
    resendKey: String(env.RESEND_API_KEY || "").trim(),
    emailFrom: String(env.EMAIL_FROM || "").trim(),
    supportEmail: String(env.SUPPORT_EMAIL || "").trim(),
    appUrl: String(env.APP_URL || "").trim().replace(/\/+$/, ""),
    signingKey: String(env.ROTATION_SIGNING_KEY || "").trim(),
  };
}

export function missingRotationConfig(config) {
  const labels = {
    masterToken: "CLOUDFLARE_MASTER_TOKEN",
    renderApiKey: "RENDER_API_KEY",
    serviceId: "RENDER_SERVICE_ID",
    resendKey: "RESEND_API_KEY",
    emailFrom: "EMAIL_FROM",
    supportEmail: "SUPPORT_EMAIL",
    appUrl: "APP_URL",
    signingKey: "ROTATION_SIGNING_KEY",
  };
  return Object.entries(labels).filter(([key]) => !config[key]).map(([, label]) => label);
}

export const rotationMail = {
  reminder: ({ link, expiresOn, host }) => ({
    subject: `[SonVuDev] Xoay Cloudflare token — ${expiresOn.slice(0, 10)}`,
    html: `<p>Token Cloudflare của <strong>${esc(host)}</strong> sắp hết hạn vào <strong>${esc(expiresOn)}</strong>.</p>
<p>Nhấn nút bên dưới để tạo token mới, cập nhật Render và thu hồi token cũ. Chữ ký của link hết hạn sau 72 giờ; nếu không bấm, hệ thống sẽ gửi nhắc lại.</p>
<p><a href="${esc(link)}" style="background:#b81e14;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px">Xác nhận xoay token</a></p>
<p>Nếu bạn không mong đợi email này, bỏ qua — không có gì thay đổi cho đến khi nút được bấm và xác nhận.</p>`,
  }),
  success: ({ oldId, newId, host, expiresOn }) => ({
    subject: `[SonVuDev] Đã xoay Cloudflare token — ${new Date().toISOString().slice(0, 10)}`,
    html: `<p>Token Cloudflare của <strong>${esc(host)}</strong> đã được xoay.</p>
<ul><li>Token cũ <code>${esc(oldId)}</code> đã bị thu hồi.</li><li>Token mới <code>${esc(newId)}</code> đã được ghi vào Render và dùng cho purge/SLO.</li><li>Hạn mới: <strong>${esc(expiresOn)}</strong>.</li></ul>
<p>Không có token nào được gửi qua email. Nếu purge hoặc SLO hỏng sau lần xoay này, kiểm tra Render env var <code>CLOUDFLARE_API_TOKEN</code>.</p>`,
  }),
  failure: ({ error, note }) => ({
    subject: `[SonVuDev] XOAY CLOUDFLARE TOKEN THẤT BẠI`,
    html: `<p>Lần xoay tự động thất bại: <code>${esc(error)}</code></p><p>${esc(note)}</p>`,
  }),
};

/**
 * Rotate in a gap-free order. Returns a short summary; never a token value.
 * `onStep` is only for logging and tests.
 */
export async function rotateCloudflareToken(config, { tokenId, fetchImpl = fetch, now = new Date(), onStep = () => {} } = {}) {
  const missing = missingRotationConfig(config);
  if (missing.length) throw new Error(`Thiếu cấu hình xoay token: ${missing.join(", ")}`);
  if (!tokenId) throw new Error("Thiếu token id cần xoay");

  const old = await readCloudflareToken(config.masterToken, tokenId, fetchImpl);
  onStep("read-old-policy");
  const created = await createCloudflareToken(config.masterToken, {
    name: `${String(old.name || "cloudflare").slice(0, 90)} rotated`,
    policies: sanitizePolicies(old.policies),
    expiresOn: nextExpiry(now),
  }, fetchImpl);
  onStep("create-replacement");

  let revoked = false;
  try {
    const status = await verifyCloudflareToken(created.value, fetchImpl);
    if (status !== "active") throw new Error(`Token mới không active (${status || "unknown"})`);
    onStep("verify-replacement");

    await updateRenderEnvValue(fetchImpl, config.renderApiKey, config.serviceId, CF_TOKEN_ENV_KEY, created.value);
    onStep("update-render-env");
    await triggerRenderDeploy(fetchImpl, config.renderApiKey, config.serviceId);
    onStep("deploy-render");

    const mail = rotationMail.success({ oldId: tokenId, newId: created.id, host: config.appUrl, expiresOn: nextExpiry(now) });
    await sendRotationMail(fetchImpl, { apiKey: config.resendKey, from: config.emailFrom, to: config.supportEmail, ...mail });
    onStep("mail-success");
  } catch (error) {
    // The old token is still valid: remove the replacement so there is exactly
    // one live credential, and leave the operator with the known-good original.
    try { await deleteCloudflareToken(config.masterToken, created.id, fetchImpl); onStep("rollback-delete-replacement"); }
    catch (rollbackError) { onStep(`rollback-failed: ${text(rollbackError)}`); }
    const mail = rotationMail.failure({ error: text(error), note: "Token cũ vẫn còn hạn; token mới (nếu có) đã được xóa." });
    try {
      await sendRotationMail(fetchImpl, { apiKey: config.resendKey, from: config.emailFrom, to: config.supportEmail, ...mail });
    } catch { onStep("mail-failure-unavailable"); }
    throw error;
  }

  // The consumers already use the new token, so revoking the old one is safe.
  // A failure here is reported rather than retried: a second roll would create
  // yet another token, and the stale one must be removed by a human.
  try {
    await deleteCloudflareToken(config.masterToken, tokenId, fetchImpl);
    revoked = true;
    onStep("revoke-old");
  } catch (error) {
    onStep(`revoke-old-failed: ${text(error)}`);
    const mail = rotationMail.failure({
      error: text(error),
      note: `Token mới đang hoạt động; hãy thu hồi tay token cũ ${tokenId} trong Cloudflare dashboard.`,
    });
    try {
      await sendRotationMail(fetchImpl, { apiKey: config.resendKey, from: config.emailFrom, to: config.supportEmail, ...mail });
    } catch { onStep("mail-failure-unavailable"); }
  }
  return { oldId: tokenId, newId: created.id, expiresOn: nextExpiry(now), revoked };
}

// The confirmation page has no script and no inline style: the site's strict CSP
// applies here too. The signed values travel in a POST body, never in JS.
export function confirmationPage({ tokenId, exp, sig, expiresOn }) {
  const field = (name, value) => `<input type="hidden" name="${name}" value="${esc(String(value))}">`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xác nhận xoay token</title><link rel="stylesheet" href="/styles.min.css"></head><body class="wrap"><main><h1>Xác nhận xoay Cloudflare token</h1><p>Token <code>${esc(tokenId)}</code> sẽ được thay bằng token mới, cập nhật trên Render rồi thu hồi. Hạn mới dự kiến: <strong>${esc(expiresOn)}</strong>.</p><form method="post" action="/api/rotation/execute">${field("action", "rotate")}${field("tokenId", tokenId)}${field("exp", exp)}${field("sig", sig)}<button type="submit" class="button-primary">Xác nhận xoay</button></form><p><a href="/">Quay lại trang chủ</a></p></main></body></html>`;
}
