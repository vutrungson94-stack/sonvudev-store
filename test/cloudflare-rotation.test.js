import test from 'node:test';
import assert from 'node:assert/strict';
// The shop's test environment, before anything imports src/.
import './helpers/env.mjs';
import {
  signRotationPayload,
  verifyRotationPayload,
  buildRotationLink,
  nextExpiry,
  sanitizePolicies,
  rotateCloudflareToken,
  rotationConfig,
  missingRotationConfig,
  confirmationPage,
  readRenderEnvValue,
} from '../src/lib/cloudflare-rotation.mjs';

const SECRET = 'signing-key-for-tests';
const APP_URL = process.env.APP_URL; // fixture from helpers/env.mjs — never hardcode the live domain
const TOKEN_ID = '40654ef8bb09066fa93bbf49af6ecda7';
const NOW = new Date('2026-11-17T12:00:00Z');

const reply = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function mockFetch({ renderFail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.Authorization });
    if (url.endsWith(`/user/tokens/${TOKEN_ID}`) && method === 'GET') {
      return reply({ success: true, result: { id: TOKEN_ID, name: 'store token', policies: [{
        effect: 'allow',
        resources: { 'com.cloudflare.api.account.zone.zone1': '*' },
        permission_groups: [{ id: 'group1', name: 'Zone Read', meta: { label: 'zone_read' } }],
      }] } });
    }
    if (url.endsWith('/user/tokens') && method === 'POST') {
      return reply({ success: true, result: { id: 'new-token-id', value: 'cfut_new_value' } });
    }
    if (url.endsWith('/user/tokens/verify')) return reply({ success: true, result: { status: 'active' } });
    if (url.includes('/env-vars/CLOUDFLARE_API_TOKEN') && method === 'PUT') {
      return renderFail ? reply({ error: 'nope' }, { ok: false, status: 500 }) : reply({});
    }
    if (url.endsWith('/deploys') && method === 'POST') return reply({});
    if (url.endsWith('/user/tokens/new-token-id') && method === 'DELETE') return reply({ success: true, result: {} });
    if (url.endsWith(`/user/tokens/${TOKEN_ID}`) && method === 'DELETE') return reply({ success: true, result: {} });
    if (url.includes('api.resend.com')) return reply({});
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

test('signed link verifies only for the exact token, action and expiry', () => {
  // exp must be relative to now: a hardcoded epoch goes stale as wall time moves
  // and would turn this into a false "link expired" failure.
  const now = Math.floor(Date.now() / 1000);
  const freshExp = String(now + 3600);
  const freshSig = signRotationPayload(SECRET, { action: 'rotate', tokenId: TOKEN_ID, exp: freshExp });
  const fresh = { action: 'rotate', tokenId: TOKEN_ID, exp: freshExp, sig: freshSig };
  assert.equal(verifyRotationPayload(SECRET, fresh).ok, true);
  assert.equal(verifyRotationPayload(SECRET, { ...fresh, tokenId: 'other' }).ok, false);
  assert.equal(verifyRotationPayload(SECRET, { ...fresh, action: 'delete' }).ok, false);
  assert.equal(verifyRotationPayload(SECRET, { ...fresh, sig: 'bad' }).ok, false);
  assert.equal(verifyRotationPayload('', fresh).ok, false);
  const expired = { action: 'rotate', tokenId: TOKEN_ID, exp: String(now - 3600), sig: signRotationPayload(SECRET, { action: 'rotate', tokenId: TOKEN_ID, exp: String(now - 3600) }) };
  assert.equal(verifyRotationPayload(SECRET, expired).ok, false);
  assert.match(verifyRotationPayload(SECRET, expired).reason, /hết hạn/);
});

test('buildRotationLink creates a verifiable, token-bound link', () => {
  const now = Date.now();
  const link = buildRotationLink({ origin: `${APP_URL}/`, secret: SECRET, tokenId: TOKEN_ID, ttlHours: 24, now });
  const url = new URL(link);
  assert.equal(url.origin, APP_URL);
  assert.equal(url.pathname, '/api/rotation/confirm');
  const params = Object.fromEntries(url.searchParams);
  assert.equal(params.tokenId, TOKEN_ID);
  assert.equal(params.exp, String(Math.floor(now / 1000) + 86400));
  assert.deepEqual(verifyRotationPayload(SECRET, params), { ok: true, tokenId: TOKEN_ID });
});

test('confirmation form carries every signed field so the POST verifies', () => {
  // The emailed GET renders POST hidden inputs; if any field (notably action)
  // is dropped, the subsequent POST has an incomplete signature and the real
  // one-click flow fails even though the link itself is valid.
  const params = Object.fromEntries(new URL(
    buildRotationLink({ origin: APP_URL, secret: SECRET, tokenId: TOKEN_ID, ttlHours: 24, now: Date.now() }),
  ).searchParams);
  const page = confirmationPage({ tokenId: params.tokenId, exp: params.exp, sig: params.sig, expiresOn: '2027-02-15' });
  const fields = Object.fromEntries([...page.matchAll(/name="([^"]+)" value="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(fields, {
    action: 'rotate', tokenId: TOKEN_ID, exp: params.exp, sig: params.sig,
  });
  assert.deepEqual(verifyRotationPayload(SECRET, fields), { ok: true, tokenId: TOKEN_ID });
});

test('policy sanitisation keeps permissions and drops read-only metadata', () => {
  const clean = sanitizePolicies([{ effect: 'allow', resources: { a: '*' }, permission_groups: [{ id: 'g', name: 'x', meta: { label: 'y' } }] }]);
  assert.deepEqual(clean, [{ effect: 'allow', resources: { a: '*' }, permission_groups: [{ id: 'g' }] }]);
});

test('nextExpiry is always in the future by the requested number of days', () => {
  assert.equal(nextExpiry(NOW, 90), '2027-02-15T12:00:00.000Z');
  assert.equal(nextExpiry(NOW, 0), '2026-11-18T12:00:00.000Z');
});

test('missing configuration names every required variable', () => {
  assert.deepEqual(missingRotationConfig(rotationConfig({})), [
    'CLOUDFLARE_MASTER_TOKEN', 'RENDER_API_KEY', 'RENDER_SERVICE_ID', 'RESEND_API_KEY',
    'EMAIL_FROM', 'SUPPORT_EMAIL', 'APP_URL', 'ROTATION_SIGNING_KEY',
  ]);
});

test('readRenderEnvValue finds the key across pages and returns null when absent', async () => {
  const urls = [];
  const paged = async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer render');
    if (urls.length === 1) {
      return reply(Array.from({ length: 100 }, (_, i) => ({ envVar: { key: `OTHER_${i}`, value: 'x' } })));
    }
    return reply([{ envVar: { key: 'CLOUDFLARE_API_TOKEN', value: 'cfut_live' } }]);
  };
  assert.equal(await readRenderEnvValue(paged, 'render', 'svc', 'CLOUDFLARE_API_TOKEN'), 'cfut_live');
  assert.equal(urls.length, 2, 'phải sang trang sau khi trang đầu đầy');
  assert.match(urls[1], /cursor=/);

  const absent = async () => reply([{ envVar: { key: 'OTHER', value: 'x' } }]);
  assert.equal(await readRenderEnvValue(absent, 'render', 'svc', 'CLOUDFLARE_API_TOKEN'), null);
});

test('rotation creates the replacement, moves consumers, then revokes the old token', async () => {
  const { calls, fetchImpl } = mockFetch();
  const config = {
    masterToken: 'master', renderApiKey: 'render', serviceId: 'svc', resendKey: 'resend',
    emailFrom: 'from@example.com', supportEmail: 'to@example.com', appUrl: APP_URL, signingKey: SECRET,
  };
  const steps = [];
  const summary = await rotateCloudflareToken(config, { tokenId: TOKEN_ID, fetchImpl, now: NOW, onStep: (s) => steps.push(s) });
  assert.deepEqual(summary, { oldId: TOKEN_ID, newId: 'new-token-id', expiresOn: '2027-02-15T12:00:00.000Z', revoked: true });
  assert.deepEqual(steps, ['read-old-policy', 'create-replacement', 'verify-replacement', 'update-render-env', 'deploy-render', 'mail-success', 'revoke-old']);
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.value, 'cfut_new_value');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/user/tokens/${TOKEN_ID}`)), 'old token must be revoked last');
});

test('a failed Render update keeps the old token and deletes the replacement', async () => {
  const { calls, fetchImpl } = mockFetch({ renderFail: true });
  const config = {
    masterToken: 'master', renderApiKey: 'render', serviceId: 'svc', resendKey: 'resend',
    emailFrom: 'from@example.com', supportEmail: 'to@example.com', appUrl: APP_URL, signingKey: SECRET,
  };
  await assert.rejects(() => rotateCloudflareToken(config, { tokenId: TOKEN_ID, fetchImpl, now: NOW }), /HTTP 500/);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/user/tokens/new-token-id')), 'replacement must be rolled back');
  assert.ok(!calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/user/tokens/${TOKEN_ID}`)), 'old token must survive a failed roll');
});
