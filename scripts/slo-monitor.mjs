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
//
// The targets, the units and the measurement live in scripts/lib/slo.mjs,
// because this file and scripts/sla-monitor.mjs each used to carry their own
// copy of them — and the two copies disagreed about the same objective. One
// source, two reporters.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOS, measureSLOs } from './lib/slo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sloFile = path.join(root, 'metrics-slo.json');
const baselineFile = path.join(root, 'metrics-slo-baseline.json');
const correctiveFile = path.join(root, 'metrics-slo-corrective.json');

const now = new Date().toISOString();

const readJsonOrDefault = async (file, def) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return def;
  }
};

const measurements = await measureSLOs(root, SLOS);

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
  const unknown = Object.values(measurements).filter((m) => m.value === null || m.value === undefined);
  if (unknown.length > 0) {
    console.log(
      `[slo] OK with gaps: ${SLOS.length - unknown.length}/${SLOS.length} SLOs measured and within target; ${unknown.length} unknown: ${unknown.map((m) => m.id).join(', ')}`,
    );
  } else {
    console.log(`[slo] OK: all ${SLOS.length} SLOs measured and within target`);
  }
}

export { result, SLOS, unresolvedBreachCount };
process.exit(exitCode);
