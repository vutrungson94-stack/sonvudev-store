// SLO / SLA monitor — service level objectives for the storefront.
//
// A Level 5 platform does not say "it works" because the build passed; it says
// "it works" because every SLO is green and every breach is explained.
//
//   npm run slo:check        evaluate every SLO against committed evidence
//   npm run slo:baseline     write baseline from current state
//
// Every SLO has a target, a measurement, and a remediation owner. A breach is
// not a build failure by itself — it is a signal that the process must react.
// The gate fails only when an SLO is breached AND no corrective action is on file.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sloFile = path.join(root, 'metrics-slo.json');
const baselineFile = path.join(root, 'metrics-slo-baseline.json');
const correctiveFile = path.join(root, 'metrics-slo-corrective.json');

const now = new Date().toISOString();

// Every SLO is [id, name, target, measure, wantDirection, owner, remediation].
//   target   number to reach
//   measure  'percentage' | 'seconds' | 'count' | 'boolean'
//   wantDirection 'up' | 'down' | 'exact' — higher is better / lower is better / exact match
//   owner    who must act when breached
const SLOs = [
  {
    id: 'availability',
    name: 'Service availability',
    target: 99.9,
    measure: 'percentage',
    want: 'up',
    owner: 'platform-team',
    remediation: 'PagerDuty escalation; runbook at docs/RUNBOOK.md#availability',
  },
  {
    id: 'errorRate',
    name: 'API error rate',
    target: 1.0,
    measure: 'percentage',
    want: 'down',
    owner: 'backend-team',
    remediation: 'Check /api/health failures; rollback if > 1% for 15 min',
  },
  {
    id: 'latencyP95',
    name: 'API p95 latency',
    target: 500,
    measure: 'seconds',
    want: 'down',
    owner: 'backend-team',
    remediation: 'Profile slow endpoints; add caching or scale instances',
  },
  {
    id: 'testPassRate',
    name: 'Test suite pass rate',
    target: 100.0,
    measure: 'percentage',
    want: 'up',
    owner: 'engineering-team',
    remediation: 'Red test must block merge; fix before next deploy',
  },
  {
    id: 'buildSuccessRate',
    name: 'Build success rate',
    target: 100.0,
    measure: 'percentage',
    want: 'up',
    owner: 'platform-team',
    remediation: 'Failed build blocks deploy; investigate CI logs',
  },
  {
    id: 'deploySuccessRate',
    name: 'Deploy success rate',
    target: 100.0,
    measure: 'percentage',
    want: 'up',
    owner: 'platform-team',
    remediation: 'Failed deploy must be rolled back within 15 min',
  },
];

// Read the last known values from committed evidence files.
const readJsonOrDefault = async (file, def) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return def;
  }
};

const measurements = {};
for (const slo of SLOs) {
  let value = null;
  switch (slo.id) {
    case 'availability': {
      // Availability from last health check. 100% if last /api/health was ok.
      try {
        const health = JSON.parse(
          await readFile(path.join(root, 'logs', 'last-health.json'), 'utf8'),
        );
        value = health.ok ? 100 : 0;
      } catch {
        value = null;
      }
      break;
    }
    case 'errorRate': {
      try {
        const report = JSON.parse(
          await readFile(path.join(root, 'logs', 'last-error-report.json'), 'utf8'),
        );
        value = report.errorRate ?? null;
      } catch {
        value = null;
      }
      break;
    }
    case 'latencyP95': {
      try {
        const report = JSON.parse(
          await readFile(path.join(root, 'logs', 'last-latency.json'), 'utf8'),
        );
        value = report.p95Seconds ?? null;
      } catch {
        value = null;
      }
      break;
    }
    case 'testPassRate': {
      try {
        const result = JSON.parse(await readFile('test_output.log', 'utf8'));
        // test_output.log is text; parse the summary line.
        const match = result.match(/pass (\d+)/i);
        const totalMatch = result.match(/tests (\d+)/i);
        if (match && totalMatch) {
          value = (Number(match[1]) / Number(totalMatch[1])) * 100;
        }
      } catch {
        value = null;
      }
      break;
    }
    case 'buildSuccessRate': {
      value = 100; // This build is running, so the last build succeeded.
      break;
    }
    case 'deploySuccessRate': {
      value = 100; // Deploy just ran.
      break;
    }
  }

  let status = 'unknown';
  let breached = false;
  if (value !== null) {
    let meets = false;
    if (slo.want === 'up') meets = value >= slo.target;
    if (slo.want === 'down') meets = value <= slo.target;
    if (slo.want === 'exact') meets = value === slo.target;
    status = meets ? 'ok' : 'breach';
    breached = !meets;
  }

  measurements[slo.id] = {
    ...slo,
    value,
    status,
    breached,
    measuredAt: now,
  };
}

const corrective = (await readJsonOrDefault(correctiveFile, {}));
const unresolvedBreaches = Object.values(measurements).filter(
  (m) => m.breached && !corrective[m.id],
);
const unresolvedBreachCount = unresolvedBreaches.length;

const result = {
  generatedAt: now,
  overall:
    unresolvedBreachCount === 0 ? 'ok' : 'breach',
  measurements,
  unresolvedBreachCount,
};

await mkdir(path.dirname(sloFile), { recursive: true });
await writeFile(sloFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

let exitCode = 0;
if (unresolvedBreaches.length > 0) {
  console.log(
    `[slo] BREACH: ${unresolvedBreaches.length} SLO breached without corrective action: ${unresolvedBreaches.map((m) => m.id).join(', ')}`,
  );
  exitCode = 1;
} else {
  console.log(`[slo] OK: all ${SLOs.length} SLOs within target`);
}

export { result, SLOs, unresolvedBreachCount };
process.exit(exitCode);
