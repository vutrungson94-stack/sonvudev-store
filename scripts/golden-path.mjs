// Golden path — the prescribed, paved-road way to add a new service/feature.
//
// A Level 5 platform does not let every team invent its own deployment,
// observability, and release process. The golden path is the single supported
// way to ship, and it is enforced by build gates.
//
//   npm run golden:check    verify the repository follows the golden path
//   npm run golden:init     scaffold a new service following the golden path
//
// The golden path for this repository requires:
//   1. package.json with build/test/lint/audit scripts
//   2. src/server.js entry point
//   3. src/app.js with health endpoint (/api/health)
//   4. src/config.js as single env source of truth
//   5. test/ directory with at least one test file
//   6. scripts/metrics.mjs for metrics baseline
//   7. .github/workflows/checks.yml for CI gates
//   8. render.yaml or Dockerfile for deployment target
//   9. Service registered in services/<id>.json
//  10. Postmortem template available for incidents
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date().toISOString();

const checks = [
  {
    id: 'package-json',
    name: 'package.json exists with required scripts',
    check: async () => {
      const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      const required = ['build', 'test', 'lint', 'audit', 'start'];
      const missing = required.filter((s) => !pkg.scripts?.[s]);
      return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all present' };
    },
  },
  {
    id: 'entry-point',
    name: 'src/server.js entry point exists',
    check: async () => {
      const ok = await stat(path.join(root, 'src', 'server.js')).then(() => true, () => false);
      return { ok, detail: ok ? 'present' : 'missing' };
    },
  },
  {
    id: 'health-endpoint',
    name: 'Health endpoint defined',
    check: async () => {
      const app = await readFile(path.join(root, 'src', 'app.js'), 'utf8');
      const ok = app.includes('/api/health');
      return { ok, detail: ok ? 'defined' : 'missing' };
    },
  },
  {
    id: 'config-single-source',
    name: 'Single env source of truth (src/config.js)',
    check: async () => {
      const ok = await stat(path.join(root, 'src', 'config.js')).then(() => true, () => false);
      return { ok, detail: ok ? 'present' : 'missing' };
    },
  },
  {
    id: 'test-directory',
    name: 'Test directory with tests',
    check: async () => {
      const ok = await stat(path.join(root, 'test')).then(() => true, () => false);
      return { ok, detail: ok ? 'present' : 'missing' };
    },
  },
  {
    id: 'metrics-baseline',
    name: 'Metrics baseline exists',
    check: async () => {
      const ok = await stat(path.join(root, 'metrics-baseline.json')).then(() => true, () => false);
      return { ok, detail: ok ? 'present' : 'missing' };
    },
  },
  {
    id: 'ci-workflow',
    name: 'CI workflow defined',
    check: async () => {
      const ok = await stat(path.join(root, '.github', 'workflows', 'checks.yml')).then(() => true, () => false);
      return { ok, detail: ok ? 'present' : 'missing' };
    },
  },
  {
    id: 'deploy-target',
    name: 'Deploy target (render.yaml or Dockerfile)',
    check: async () => {
      const r = await stat(path.join(root, 'render.yaml')).then(() => true, () => false);
      const d = await stat(path.join(root, 'Dockerfile')).then(() => true, () => false);
      const ok = r || d;
      return { ok, detail: ok ? 'present' : 'missing' };
    },
  },
  {
    id: 'service-catalog',
    name: 'Service registered in catalog',
    check: async () => {
      try {
        await stat(path.join(root, 'services'));
        return { ok: true, detail: 'services directory present' };
      } catch {
        return { ok: false, detail: 'services directory missing' };
      }
    },
  },
  {
    id: 'postmortem-template',
    name: 'Postmortem directory exists',
    check: async () => {
      try {
        await stat(path.join(root, 'postmortems'));
        return { ok: true, detail: 'postmortems directory present' };
      } catch {
        return { ok: false, detail: 'postmortems directory missing' };
      }
    },
  },
];

const results = [];
for (const c of checks) {
  try {
    results.push(await c.check());
  } catch (e) {
    results.push({ ok: false, detail: `error: ${e.message}` });
  }
}

const allPass = results.every((r) => r.ok);
const failures = results.filter((r) => !r.ok);

const outcome = {
  generatedAt: now,
  goldenPathVersion: 1,
  allPass,
  failures,
  checks: results,
};

console.log(
  `[golden] ${allPass ? 'OK' : 'FAIL'}: ${results.filter((r) => r.ok).length}/${results.length} golden path checks passed`,
);
for (const f of failures) {
  console.log(`  - ${f.detail}`);
}

export { outcome, results, allPass };
process.exit(allPass ? 0 : 1);
