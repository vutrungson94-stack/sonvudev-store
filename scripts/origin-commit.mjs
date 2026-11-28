// Read-only probe: which origins are healthy and which still serve an old sha?
// Used by the scheduled auto-heal workflow so a free host that comes back
// (quota reset, unsuspend, machine wake) receives the latest commit without
// waiting for the next human push. No secret is printed; only sha/status.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const parseCommit = (body) => {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const sha = String(parsed?.commit || '').trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : '';
  } catch { return ''; }
};

const probe = async (url) => {
  if (!url) return { status: 0, commit: '' };
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    return { status: response.status, commit: response.ok ? parseCommit(await response.text()) : '' };
  } catch { return { status: 0, commit: '' }; }
};

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const head = String(process.env.EXPECTED_SHA || '').trim();
  const fly = await probe(String(process.env.FLY_HEALTH_URL || '').trim());
  const render = await probe(String(process.env.RENDER_HEALTH_URL || '').trim());
  // A host that is down (status 0 or >=500) is not "stale" - it is simply not
  // serving. Deploying into a suspension cannot help. Only a HEALTHY host with
  // an older sha is stale: that is the recovered-free-origin case.
  const stale = (result) => result.status >= 200 && result.status < 300
    && Boolean(head) && Boolean(result.commit) && result.commit !== head;

  const lines = [
    `head=${head}`,
    `flyStatus=${fly.status}`,
    `flyCommit=${fly.commit}`,
    `flyStale=${stale(fly)}`,
    `renderStatus=${render.status}`,
    `renderCommit=${render.commit}`,
    `renderStale=${stale(render)}`,
  ];
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, { encoding: 'utf8' });
  }
}
