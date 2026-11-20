// Is the Render service suspended? One read-only GET, no mutation.
//
// The edge balancer fails over *traffic* when Render is down, but it cannot
// deploy code. CI needs to know whether Render can auto-deploy this push: if
// it is suspended, the Fly deploy job must run before `deployed-site` starts
// waiting for the live sha. Same API call as scripts/render-service-id.mjs.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Render returns the service object directly from GET /v1/services/{id}.
 * Accept the list wrapper too so a copy/paste from render-service-id output
 * cannot silently read an undefined field and report "not suspended".
 */
export function parseSuspended(body) {
  const service = Array.isArray(body) ? (body[0]?.service || body[0]) : body;
  const state = service?.suspended;
  if (typeof state !== 'string') {
    throw new Error('Phản hồi Render không có trường suspended');
  }
  return state === 'suspended';
}

// Importing this file for tests must not call the API or exit the runner.
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const apiKey = String(process.env.RENDER_API_KEY || '').trim();
  const serviceId = String(process.env.RENDER_SERVICE_ID || '').trim();
  if (!apiKey || !serviceId) {
    console.error('[render] Thiếu RENDER_API_KEY hoặc RENDER_SERVICE_ID.');
    process.exit(2);
  }

  let response;
  try {
    response = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`, {
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

  let suspended;
  try {
    suspended = parseSuspended(await response.json().catch(() => null));
  } catch (error) {
    console.error(`[render] ${error.message}`);
    process.exit(1);
  }

  const line = `suspended=${suspended}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`, { encoding: 'utf8' });
  }
}
