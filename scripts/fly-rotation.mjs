// Rotate the Fly deploy token used by CI. Render is the source of truth:
// CI reads FLY_API_TOKEN from Render at job time, so a roll never has to write
// a GitHub secret. A deploy token cannot create tokens (verified 2026-11-20),
// so FLY_ADMIN_TOKEN is the owner's personal Fly token with token-create rights.
import { sendRotationMail, readRenderEnvValue } from '../src/lib/cloudflare-rotation.mjs';

export const FLY_TOKEN_KEY = 'FLY_API_TOKEN';
const FLY_GRAPHQL = 'https://api.fly.io/graphql';
const RENDER_API = 'https://api.render.com/v1';
const DEFAULT_LIFETIME_DAYS = 365;
const text = (error) => String(error?.message || error || '').slice(0, 300);

export function flyRotationConfig(env = process.env) {
  return {
    adminToken: String(env.FLY_ADMIN_TOKEN || '').trim(),
    orgId: String(env.FLY_ORG_ID || '').trim(),
    appName: String(env.FLY_APP_NAME || '').trim(),
    renderApiKey: String(env.RENDER_API_KEY || '').trim(),
    serviceId: String(env.RENDER_SERVICE_ID || '').trim(),
    resendKey: String(env.RESEND_API_KEY || '').trim(),
    emailFrom: String(env.EMAIL_FROM || '').trim(),
    supportEmail: String(env.SUPPORT_EMAIL || '').trim(),
    appUrl: String(env.APP_URL || '').trim().replace(/\/+$/, ''),
  };
}

export function missingFlyRotationConfig(config) {
  const labels = {
    adminToken: 'FLY_ADMIN_TOKEN', orgId: 'FLY_ORG_ID', appName: 'FLY_APP_NAME',
    renderApiKey: 'RENDER_API_KEY', serviceId: 'RENDER_SERVICE_ID',
    resendKey: 'RESEND_API_KEY', emailFrom: 'EMAIL_FROM',
    supportEmail: 'SUPPORT_EMAIL', appUrl: 'APP_URL',
  };
  return Object.entries(labels).filter(([key]) => !config[key]).map(([, label]) => label);
}

/** Introspected Fly GraphQL: createLimitedAccessToken(input: SetSecretsInput-style object). */
export function createTokenInput({ name, orgId, appName, expiryHours = DEFAULT_LIFETIME_DAYS * 24 }) {
  if (!name || !orgId || !appName) throw new Error('Thiếu name/orgId/appName khi tạo token Fly');
  return {
    input: {
      name: String(name).slice(0, 90),
      organizationId: orgId,
      profile: 'deploy',
      profileParams: { app_id: appName },
      expiry: `${expiryHours}h`,
    },
  };
}

/** deleteLimitedAccessToken accepts the token value itself — no id lookup needed. */
export function revokeInput(token) {
  if (!token) throw new Error('Thiếu token Fly cần thu hồi');
  return { input: { token } };
}

export function parseNewToken(body) {
  if (body?.errors?.length) throw new Error(`Fly GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  const token = body?.data?.createLimitedAccessToken?.limitedAccessToken;
  if (!token?.tokenHeader || !token?.id) throw new Error('Fly không trả token deploy mới');
  return token;
}

export function nextExpiry(now = new Date(), days = DEFAULT_LIFETIME_DAYS) {
  return new Date(now.getTime() + days * 86400000).toISOString();
}

const gql = async (fetchImpl, token, query, variables) => {
  const response = await fetchImpl(FLY_GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Fly HTTP ${response.status}: ${raw.slice(0, 300)}`);
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error('Fly trả phản hồi không phải JSON'); }
  if (body.errors?.length) throw new Error(`Fly GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  return body;
};

const updateRenderSecret = (fetchImpl, apiKey, serviceId, key, value) =>
  fetchImpl(`${RENDER_API}/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ value }),
    signal: AbortSignal.timeout(30000),
  }).then((response) => {
    if (!response.ok) throw new Error(`Render PUT ${key} HTTP ${response.status}`);
    return response.json();
  });

const mail = {
  success: ({ appName, newId, expiresOn }) => ({
    subject: `[SonVuDev] Đã xoay Fly deploy token — ${new Date().toISOString().slice(0, 10)}`,
    html: `<p>Token deploy Fly của <strong>${appName}</strong> đã được xoay.</p><ul><li>Token mới <code>${newId}</code>, hạn <strong>${expiresOn}</strong>.</li><li>Render env <code>FLY_API_TOKEN</code> đã được cập nhật; CI đọc giá trị này lúc chạy.</li><li>Token cũ đã bị thu hồi.</li></ul><p>Không có giá trị token nào được gửi qua email.</p>`,
  }),
  failure: ({ appName, error }) => ({
    subject: `[SonVuDev] XOAY FLY TOKEN THẤT BẠI`,
    html: `<p>Xoay token Fly của <strong>${appName}</strong> thất bại: <code>${error}</code></p><p>Token cũ vẫn còn hạn; token mới (nếu có) đã bị thu hồi và Render env được khôi phục.</p>`,
  }),
};

/**
 * Returns a summary only — never a token value. `onStep` receives step names
 * for logs/tests, never secrets.
 */
export async function rotateFlyToken(config, { fetchImpl = fetch, now = new Date(), onStep = () => {} } = {}) {
  const missing = missingFlyRotationConfig(config);
  if (missing.length) throw new Error(`Thiếu cấu hình xoay Fly token: ${missing.join(', ')}`);

  const oldToken = await readRenderEnvValue(fetchImpl, config.renderApiKey, config.serviceId, FLY_TOKEN_KEY);
  if (!oldToken) throw new Error('Không đọc được FLY_API_TOKEN hiện tại từ Render');
  onStep('read-old-token');

  const created = parseNewToken(await gql(fetchImpl, config.adminToken,
    'mutation($input: CreateLimitedAccessTokenInput!){ createLimitedAccessToken(input:$input){ limitedAccessToken { id tokenHeader expiresAt } } }',
    createTokenInput({ name: `${config.appName} deploy rotated`, orgId: config.orgId, appName: config.appName })));
  onStep('create-replacement');

  let renderUpdated = false;
  try {
    const check = await gql(fetchImpl, created.tokenHeader, 'query($name:String!){ app(name:$name){ id } }', { name: config.appName });
    if (!check.data?.app?.id) throw new Error('Token Fly mới không đọc được app');
    onStep('verify-replacement');

    await updateRenderSecret(fetchImpl, config.renderApiKey, config.serviceId, FLY_TOKEN_KEY, created.tokenHeader);
    renderUpdated = true;
    onStep('update-render-env');

    const ok = mail.success({ appName: config.appName, newId: created.id, expiresOn: nextExpiry(now) });
    await sendRotationMail(fetchImpl, { apiKey: config.resendKey, from: config.emailFrom, to: config.supportEmail, ...ok });
    onStep('mail-success');
  } catch (error) {
    if (renderUpdated) {
      try { await updateRenderSecret(fetchImpl, config.renderApiKey, config.serviceId, FLY_TOKEN_KEY, oldToken); onStep('rollback-render-env'); }
      catch { onStep('rollback-render-env-failed'); }
    }
    try {
      await gql(fetchImpl, config.adminToken,
        'mutation($input: DeleteLimitedAccessTokenInput!){ deleteLimitedAccessToken(input:$input){ token } }',
        revokeInput(created.tokenHeader));
      onStep('rollback-revoke-replacement');
    } catch { onStep('rollback-revoke-failed'); }
    const bad = mail.failure({ appName: config.appName, error: text(error) });
    try { await sendRotationMail(fetchImpl, { apiKey: config.resendKey, from: config.emailFrom, to: config.supportEmail, ...bad }); }
    catch { onStep('mail-failure-unavailable'); }
    throw error;
  }

  try {
    await gql(fetchImpl, config.adminToken,
      'mutation($input: DeleteLimitedAccessTokenInput!){ deleteLimitedAccessToken(input:$input){ token } }',
      revokeInput(oldToken));
    onStep('revoke-old');
  } catch (error) {
    onStep(`revoke-old-failed: ${text(error)}`);
  }
  return { newId: created.id, expiresOn: nextExpiry(now) };
}

// Re-export for callers that build config from process.env in one place.
export { sendRotationMail, readRenderEnvValue };
