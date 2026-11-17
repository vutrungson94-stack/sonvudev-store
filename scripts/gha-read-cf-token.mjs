// Expose the live Cloudflare token to a GitHub Actions job by reading it from
// Render. Render is the single source of truth, so a one-click token roll never
// has to rewrite a GitHub Secret (or hand a secret-write PAT to CI).
//
// Two modes, deliberately kept in ONE place rather than as workflow shell tricks:
//   node scripts/gha-read-cf-token.mjs              best-effort (post-deploy purge)
//   node scripts/gha-read-cf-token.mjs --required   hard failure (SLO ingest, reminder)
//
// A missing optional token is announced as a ::warning:: and exits 0: skipping a
// purge does not invalidate a green deploy. In --required mode the same absence
// is a ::error:: and exits 1: an SLO written without its real source is worse
// than no SLO. No `continue-on-error` and no `|| true` in any workflow.
import { appendFileSync } from 'node:fs';
import { readRenderEnvValue } from '../src/lib/cloudflare-rotation.mjs';

const required = process.argv.includes('--required');
const apiKey = String(process.env.RENDER_API_KEY || '').trim();
const serviceId = String(process.env.RENDER_SERVICE_ID || '').trim();
const githubEnv = String(process.env.GITHUB_ENV || '').trim();
const KEY = 'CLOUDFLARE_API_TOKEN';

const skip = (message) => {
  if (required) {
    console.error(`::error::${message}`);
    process.exit(1);
  }
  console.log(`::warning::${message} — bỏ qua`);
  process.exit(0);
};

if (!apiKey || !serviceId) {
  skip(`Không đọc được ${KEY} từ Render: thiếu RENDER_API_KEY hoặc RENDER_SERVICE_ID`);
}

try {
  const token = await readRenderEnvValue(fetch, apiKey, serviceId, KEY);
  if (!token) skip(`Không đọc được ${KEY} từ Render env-vars`);
  // Mask before anything else prints, including GITHUB_ENV writes and later steps.
  console.log(`::add-mask::${token}`);
  if (!githubEnv) skip('Thiếu GITHUB_ENV — không thể truyền token cho các bước sau');
  appendFileSync(githubEnv, `${KEY}=${token}\n`, { encoding: 'utf8', flag: 'a' });
  console.log(`[gha-read-cf-token] đã nạp ${KEY} từ Render vào GITHUB_ENV`);
} catch (error) {
  skip(`Không đọc được ${KEY} từ Render: ${String(error?.message || error).slice(0, 200)}`);
}
