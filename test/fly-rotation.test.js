import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenInput, revokeInput, parseNewToken, rotateFlyToken, flyRotationConfig, missingFlyRotationConfig } from '../scripts/fly-rotation.mjs';

const reply = (body, { ok = true, status = 200 } = {}) => ({
  ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
});

const config = () => ({
  adminToken: 'fly-admin', orgId: 'org-1', appName: 'sonvudev-store',
  renderApiKey: 'render', serviceId: 'srv-1', resendKey: 'resend',
  emailFrom: 'from@example.com', supportEmail: 'to@example.com', appUrl: 'https://shop.example',
});

function mockFetch({ mailFail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const auth = options.headers?.Authorization;
    calls.push({ url, method, body, auth });
    if (url.includes('/env-vars') && method === 'GET') {
      return reply([
        { envVar: { key: 'FLY_API_TOKEN', value: 'fly_old' } },
        { envVar: { key: 'FLY_TOKEN_ID', value: 'old-id' } },
      ]);
    }
    if (url.includes('api.fly.io/graphql') && auth === 'Bearer fly-admin') {
      if (body.query.includes('createLimitedAccessToken')) {
        return reply({ data: { createLimitedAccessToken: { limitedAccessToken: { id: 'new-id', tokenHeader: 'FlyV1 fm2_new' } } } });
      }
      if (body.query.includes('deleteLimitedAccessToken')) return reply({ data: { deleteLimitedAccessToken: { token: 'ok' } } });
    }
    if (url.includes('api.fly.io/graphql') && auth === 'Bearer FlyV1 fm2_new') {
      return reply({ data: { app: { id: 'sonvudev-store' } } });
    }
    if (url.includes('/env-vars/FLY_') && method === 'PUT') return reply({});
    if (url.includes('api.resend.com')) return mailFail ? reply({ error: 'nope' }, { ok: false, status: 500 }) : reply({});
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

test('createTokenInput pins profile, app scope and one-year expiry', () => {
  const input = createTokenInput({ name: 'svc deploy', orgId: 'org-1', appName: 'sonvudev-store' });
  assert.equal(input.input.profile, 'deploy');
  assert.deepEqual(input.input.profileParams, { app_id: 'sonvudev-store' });
  assert.equal(input.input.expiry, '8760h');
  assert.equal(input.input.organizationId, 'org-1');
});

test('revoke uses the stored token id; malformed create response fails loudly', () => {
  assert.deepEqual(revokeInput('old-id'), { input: { id: 'old-id' } });
  assert.throws(() => revokeInput(''), /Thiếu id token/);
  assert.throws(() => parseNewToken({ errors: [{ message: 'nope' }] }), /nope/);
  assert.throws(() => parseNewToken({ data: {} }), /không trả token/);
});

test('missing config names every Fly variable', () => {
  assert.deepEqual(missingFlyRotationConfig(flyRotationConfig({})), [
    'FLY_ADMIN_TOKEN', 'FLY_ORG_ID', 'FLY_APP_NAME', 'RENDER_API_KEY', 'RENDER_SERVICE_ID',
    'RESEND_API_KEY', 'EMAIL_FROM', 'SUPPORT_EMAIL', 'APP_URL',
  ]);
});

test('happy path: verify, update Render, mail, then revoke old token', async () => {
  const { calls, fetchImpl } = mockFetch();
  const steps = [];
  const summary = await rotateFlyToken(config(), { fetchImpl, onStep: (s) => steps.push(s) });
  assert.equal(summary.newId, 'new-id');
  assert.deepEqual(steps, ['read-old-token', 'create-replacement', 'verify-replacement', 'update-render-env', 'mail-success', 'revoke-old']);
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/env-vars/FLY_API_TOKEN'));
  assert.equal(put.body.value, 'FlyV1 fm2_new');
  const idPut = calls.find((c) => c.method === 'PUT' && c.url.includes('/env-vars/FLY_TOKEN_ID'));
  assert.equal(idPut.body.value, 'new-id');
  const revoke = calls.find((c) => c.body?.query?.includes('deleteLimitedAccessToken'));
  assert.equal(revoke.body.variables.input.id, 'old-id');
});

test('mail failure restores Render env and revokes the replacement, keeps old token', async () => {
  const { calls, fetchImpl } = mockFetch({ mailFail: true });
  await assert.rejects(() => rotateFlyToken(config(), { fetchImpl }), /HTTP 500/);
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 4, 'token + id written, then both restored');
  assert.equal(puts[0].body.value, 'FlyV1 fm2_new');
  assert.equal(puts[1].body.value, 'new-id');
  assert.equal(puts[2].body.value, 'fly_old');
  assert.equal(puts[3].body.value, 'old-id');
  const revokes = calls.filter((c) => c.body?.query?.includes('deleteLimitedAccessToken'));
  assert.equal(revokes.length, 1, 'only the replacement was revoked');
  assert.equal(revokes[0].body.variables.input.id, 'new-id');
});
