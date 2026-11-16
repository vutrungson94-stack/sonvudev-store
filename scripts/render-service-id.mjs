// Find the Render service id (and owner id) from an API key and a service name.
//
// Render's dashboard shows the service id in its URL
// (https://dashboard.render.com/web/srv-xxxx), but that is a UI detail and it
// changes when the service is recreated. The API is the source: one GET, no
// mutation, and the same call the rotation script and the SLO ingest make.
//
//   RENDER_API_KEY=... node scripts/render-service-id.mjs                 # list all
//   RENDER_API_KEY=... node scripts/render-service-id.mjs sonvudev-store  # filter
//
// Output is tab-separated so it can be pasted into a shell or a secret:
//   srv-xxxx  web  sonvudev-store  owner=wrkspc-xxxx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });

const apiKey = (process.env.RENDER_API_KEY || '').trim();
if (!apiKey) {
  console.error('[render] Thiếu RENDER_API_KEY (Render → Account Settings → API Keys).');
  process.exit(2);
}

const name = process.argv.slice(2).join(' ').trim();
const url = new URL('https://api.render.com/v1/services');
if (name) url.searchParams.set('name', name);
url.searchParams.set('limit', '100');

let response;
try {
  response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
} catch (error) {
  console.error(`[render] Không gọi được API: ${error.message}`);
  process.exit(1);
}
if (!response.ok) {
  const text = await response.text().catch(() => '');
  console.error(`[render] HTTP ${response.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}
const body = await response.json().catch(() => null);
// Render's list endpoint returns { cursor, service } per item; the first draft
// read id/name from the wrapper and printed "?" for every field.
const services = (Array.isArray(body) ? body : []).map((item) => item.service || item);
if (services.length === 0) {
  console.log(name ? `[render] Không tìm thấy service tên "${name}".` : '[render] Không có service nào trong workspace.');
  process.exit(0);
}
for (const service of services) {
  const id = service.id || service.serviceId || '?';
  const type = service.type || service.serviceType || '?';
  const label = service.name || service.displayName || '?';
  const owner = service.ownerId || service.owner?.id || '?';
  console.log(`${id}\t${type}\t${label}\towner=${owner}`);
}
console.log(`\n[render] ${services.length} service. Dùng cột 1 làm RENDER_SERVICE_ID.`);