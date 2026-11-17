// Monthly reminder for the Cloudflare API token roll.
//
// The token is the same credential the post-deploy purge and the daily SLO
// ingest use. It expires after 90 days and cannot renew itself, so once a month
// this mails a signed, 72-hour confirmation link to the owner. Nothing changes
// until the link is opened AND the confirmation form is submitted — mail clients
// that prefetch links therefore cannot rotate anything.
//
// Usage: npm run cf:rotation:remind
// Required env: CLOUDFLARE_API_TOKEN (the live token, read-only here),
//   ROTATION_SIGNING_KEY, RESEND_API_KEY, EMAIL_FROM, SUPPORT_EMAIL, APP_URL.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  buildRotationLink,
  rotationMail,
  sendRotationMail,
} from '../src/lib/cloudflare-rotation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });
const value = (key) => String(process.env[key] || '').trim();

const token = value('CLOUDFLARE_API_TOKEN');
const signingKey = value('ROTATION_SIGNING_KEY');
const resendKey = value('RESEND_API_KEY');
const emailFrom = value('EMAIL_FROM');
const supportEmail = value('SUPPORT_EMAIL');
const appUrl = value('APP_URL').replace(/\/+$/, '');

const missing = [
  !token && 'CLOUDFLARE_API_TOKEN',
  !signingKey && 'ROTATION_SIGNING_KEY',
  !resendKey && 'RESEND_API_KEY',
  !emailFrom && 'EMAIL_FROM',
  !supportEmail && 'SUPPORT_EMAIL',
  !appUrl && 'APP_URL',
].filter(Boolean);
if (missing.length) {
  console.error(`[cf:remind] Thiếu env vars: ${missing.join(', ')}`);
  process.exit(2);
}

try {
  const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  const id = body?.result?.id;
  const expiresOn = body?.result?.expires_on || 'không rõ';
  if (!id || body?.result?.status !== 'active') {
    throw new Error(`Token không active — không gửi link xoay (status=${body?.result?.status || 'unknown'})`);
  }
  const link = buildRotationLink({ origin: appUrl, secret: signingKey, tokenId: id });
  const mail = rotationMail.reminder({ link, expiresOn, host: appUrl });
  await sendRotationMail(fetch, { apiKey: resendKey, from: emailFrom, to: supportEmail, ...mail });
  console.log(`[cf:remind] đã gửi link xoay cho ${supportEmail}; token=${id}; hạn=${expiresOn}`);
} catch (error) {
  console.error(`[cf:remind] thất bại: ${error.message}`);
  process.exit(1);
}
