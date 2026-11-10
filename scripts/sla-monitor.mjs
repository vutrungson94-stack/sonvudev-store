// SLA (Service Level Agreement) monitor.
//
// Đo lường và báo cáo việc tuân thủ cam kết cấp độ dịch vụ theo docs/SLO.md.
//
//   npm run sla:check   đánh giá tất cả SLO/SLA và báo cáo sai sót
//
// The objectives, their units and the way they are measured live in
// scripts/lib/slo.mjs. This file used to carry a second copy of them — and the
// copy disagreed with the first: it reported build and deploy success as 100
// because a report file existed, while scripts/slo-monitor.mjs reported the
// same two objectives as unknown. One definition, two reporters, no more.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOS, measureSLOs } from './lib/slo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slaFile = path.join(root, 'metrics-sla.json');

const now = new Date().toISOString();

const measurements = await measureSLOs(root, SLOS);

const result = {
  generatedAt: now,
  overall: Object.values(measurements).some((m) => m.breached) ? 'breach' : 'ok',
  measurements,
};

await mkdir(path.dirname(slaFile), { recursive: true });
await writeFile(slaFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

let exitCode = 0;
const breached = Object.values(measurements).filter((m) => m.breached);
const unknown = Object.values(measurements).filter((m) => m.value === null || m.value === undefined);
if (breached.length > 0) {
  console.log(`[sla] BREACH: ${breached.length} SLA breached: ${breached.map((m) => m.id).join(', ')}`);
  exitCode = 1;
} else if (unknown.length > 0) {
  console.log(`[sla] OK with gaps: ${SLOS.length - unknown.length}/${SLOS.length} SLO measured and within target; ${unknown.length} unknown (${unknown.map((m) => m.id).join(', ')})`);
} else {
  console.log(`[sla] OK: all ${SLOS.length} SLOs measured and within target`);
}

export { result, SLOS };
process.exit(exitCode);
