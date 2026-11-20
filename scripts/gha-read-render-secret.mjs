// Read any Render env var into a GitHub Actions job without storing it in a
// repo secret. Render is the source of truth for CI credentials; this is the
// generic form of scripts/gha-read-cf-token.mjs (same masking, same fail modes).
import { appendFileSync } from 'node:fs';
import { readRenderEnvValue } from '../src/lib/cloudflare-rotation.mjs';

const required = process.argv.includes('--required');
const key = String(process.env.KEY || '').trim();
const outputName = String(process.env.OUTPUT_NAME || key).trim();
const apiKey = String(process.env.RENDER_API_KEY || '').trim();
const serviceId = String(process.env.RENDER_SERVICE_ID || '').trim();
const githubEnv = String(process.env.GITHUB_ENV || '').trim();

const skip = (message) => {
  if (required) { console.error(`::error::${message}`); process.exit(1); }
  console.log(`::warning::${message} — bỏ qua`);
  process.exit(0);
};

if (!key || !outputName) skip('Thiếu KEY hoặc OUTPUT_NAME');
if (!apiKey || !serviceId) skip(`Không đọc được ${key} từ Render: thiếu RENDER_API_KEY hoặc RENDER_SERVICE_ID`);
if (!githubEnv) skip('Thiếu GITHUB_ENV — không thể truyền giá trị cho các bước sau');

try {
  const value = await readRenderEnvValue(fetch, apiKey, serviceId, key);
  if (!value) skip(`Không đọc được ${key} từ Render env-vars`);
  console.log(`::add-mask::${value}`);
  appendFileSync(githubEnv, `${outputName}=${value}\n`, { encoding: 'utf8', flag: 'a' });
  console.log(`[gha-read-render-secret] đã nạp ${key} từ Render vào ${outputName}`);
} catch (error) {
  skip(`Không đọc được ${key} từ Render: ${String(error?.message || error).slice(0, 200)}`);
}
