// One definition of the service level objectives, one way to measure them.
//
// scripts/slo-monitor.mjs and scripts/sla-monitor.mjs each carried their own
// copy of the target list, and the two copies disagreed: one reported build and
// deploy success as "unknown" because there was no evidence, the other
// reported them as 100 because a report file existed. The same objective
// therefore had two answers, both of them committed, and the 100 was the kind
// of number that looks like evidence and is not — the metric AGENTS.md calls a
// self-certifying one.
//
// This module owns the targets, the units and the measurement. The two scripts
// differ only in what they do with the result: one writes the gate file the
// metrics read, the other writes the SLA report.
//
// The targets come from docs/SLO.md, which is the document a reader trusts. If
// the two disagree, this file is wrong and docs/SLO.md is right.
//
// Every objective names the evidence it is measured from, and an objective with
// no evidence is "unknown" — never 0 and never 100.
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The objectives. One list, used by both reporters.
 *
 *   target   the number to reach
 *   measure  'percentage' | 'milliseconds' | 'count' | 'boolean'
 *   want     'up' (higher is better) | 'down' (lower is better)
 *   basis    'window' (a rate over a period) | 'last-run' (one observation)
 *   source   the file the value is read from — the thing a reader checks when
 *            they want to know whether the number is real
 */
export const SLOS = [
  {
    id: 'availability',
    name: 'Service availability',
    target: 99.5,
    measure: 'percentage',
    want: 'up',
    unit: '%',
    basis: 'window',
    source: 'logs/last-availability.json — 30-day window from the edge access log',
    owner: 'platform-team',
    remediation: 'Check the deploy history and the incident log; runbook at docs/RUNBOOK.md',
  },
  {
    id: 'errorRate',
    name: 'API error rate',
    target: 1.0,
    measure: 'percentage',
    want: 'down',
    unit: '%',
    basis: 'window',
    source: 'logs/last-error-report.json',
    owner: 'backend-team',
    remediation: 'Check /api/health failures; roll back if the rate holds for 15 minutes',
  },
  {
    id: 'latencyP95',
    name: 'API p95 latency',
    target: 400,
    measure: 'milliseconds',
    want: 'down',
    unit: 'ms',
    basis: 'window',
    source: 'logs/last-latency.json (p95Seconds, converted to milliseconds)',
    owner: 'backend-team',
    remediation: 'Profile the slow endpoints; add caching or scale the instances',
  },
  {
    id: 'testPassRate',
    name: 'Test suite pass rate',
    target: 100.0,
    measure: 'percentage',
    want: 'up',
    unit: '%',
    basis: 'last-run',
    source: 'test_output.log',
    owner: 'engineering-team',
    remediation: 'A red test must block the merge; fix it before the next deploy',
  },
  {
    id: 'buildSuccessRate',
    name: 'Build success rate',
    target: 100.0,
    measure: 'percentage',
    want: 'up',
    unit: '%',
    basis: 'last-run',
    source: 'build-reports/web-build.json — the outcome of the last build, not a rate',
    owner: 'platform-team',
    remediation: 'A failed build blocks the deploy; read the CI log',
  },
  {
    id: 'deploySuccessRate',
    name: 'Deploy success rate',
    target: 100.0,
    measure: 'percentage',
    want: 'up',
    unit: '%',
    basis: 'last-run',
    source: 'logs/last-deploy.json — written by the deploy step after it finishes',
    owner: 'platform-team',
    remediation: 'A failed deploy must be rolled back within 15 minutes',
  },
  {
    id: 'escapeRate',
    name: 'Escaped defect rate',
    target: 5.0,
    measure: 'percentage',
    want: 'down',
    unit: '%',
    basis: 'window',
    source: 'metrics-defect-escape.json',
    owner: 'engineering-team',
    remediation: 'Every escaped defect gets a root cause; see docs/CMMI-L5-ROADMAP.md',
  },
];

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Measures every objective from the evidence on disk.
 *
 * A value that cannot be measured is null, and null is reported as "unknown".
 * Zero is a measurement; null is the absence of one.
 *
 * @param {string} root the project root
 * @param {typeof SLOS} slos the objectives to measure
 * @returns {Promise<Record<string, object>>}
 */
export async function measureSLOs(root, slos = SLOS) {
  const measurements = {};
  for (const slo of slos) {
    let value = null;
    let sampleSize = 0;

    switch (slo.id) {
      case 'availability': {
        // The 30-day window from the edge access log. The health probe is a
        // different question — "is it up right now" — and is not availability;
        // conflating the two is how a 99.9% claim survives on the back of one
        // green probe.
        const report = await readJson(path.join(root, 'logs', 'last-availability.json'));
        if (report && typeof report.availability === 'number') {
          value = report.availability;
          sampleSize = Number(report.samples) || 0;
        }
        break;
      }
      case 'errorRate': {
        const report = await readJson(path.join(root, 'logs', 'last-error-report.json'));
        if (report && typeof report.errorRate === 'number') {
          value = report.errorRate;
          sampleSize = Number(report.samples) || 0;
        }
        break;
      }
      case 'latencyP95': {
        const report = await readJson(path.join(root, 'logs', 'last-latency.json'));
        if (report && typeof report.p95Seconds === 'number') {
          // The evidence is in seconds; the objective is in milliseconds. The
          // two used to be the same number with different names, which made a
          // 500 ms objective look like a 500 second one.
          value = Math.round(report.p95Seconds * 1000);
          sampleSize = Number(report.samples) || 0;
        }
        break;
      }
      case 'testPassRate': {
        // test_output.log is plain text: count the passes and the failures
        // ourselves instead of JSON.parsing it, which used to throw on every
        // run and leave this objective at unknown.
        let text = null;
        try {
          text = await readFile(path.join(root, 'test_output.log'), 'utf8');
        } catch {
          text = null;
        }
        if (text) {
          const passMatch = text.match(/pass (\d+)/i);
          const failMatch = text.match(/fail (\d+)/i);
          if (passMatch) {
            const passes = Number(passMatch[1]);
            const failures = failMatch ? Number(failMatch[1]) : 0;
            sampleSize = passes + failures;
            if (sampleSize > 0) value = (passes / sampleSize) * 100;
          }
        }
        break;
      }
      case 'buildSuccessRate': {
        // The outcome of the last build, and it says so: a build report that
        // exists proves the build finished, not that builds succeed 100% of
        // the time. The basis field carries that distinction to the reader.
        const report = await readJson(path.join(root, 'build-reports', 'web-build.json'));
        if (report && report.status) {
          value = report.status === 'passed' ? 100 : 0;
          sampleSize = 1;
        }
        break;
      }
      case 'deploySuccessRate': {
        const report = await readJson(path.join(root, 'logs', 'last-deploy.json'));
        if (report && typeof report.ok === 'boolean') {
          value = report.ok ? 100 : 0;
          sampleSize = 1;
        }
        break;
      }
      case 'escapeRate': {
        const report = await readJson(path.join(root, 'metrics-defect-escape.json'));
        if (report && typeof report.escapeRate === 'number') {
          value = report.escapeRate * 100;
          sampleSize = Number(report.total) || 0;
        }
        break;
      }
      default:
        break;
    }

    let status = 'unknown';
    let breached = false;
    if (value !== null) {
      const meets = slo.want === 'up' ? value >= slo.target : value <= slo.target;
      status = meets ? 'ok' : 'breach';
      breached = !meets;
    }

    measurements[slo.id] = {
      ...slo,
      value,
      status,
      breached,
      sampleSize,
      measuredAt: new Date().toISOString(),
    };
  }
  return measurements;
}
