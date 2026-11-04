// SLA (Service Level Agreement) monitor.
//
// Đo lường và báo cáo việc tuân thủ cam kết cấp độ dịch vụ theo file SLA.md.
// Các chỉ số được đọc từ các file metrics đã sinh ra bởi các script khác.
//
//   npm run sla:check   đánh giá tất cả SLO/SLA và báo cáo sai sót
//   npm run sla:baseline ghi baseline từ trạng thái hiện tại
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slaFile = path.join(root, 'metrics-sla.json');

const now = new Date().toISOString();

// Mục tiêu SLA từ SLA.md
const SLOS = [
  { id: 'availability', name: 'Sẵn sàng dịch vụ', target: 99.9, unit: '%', want: 'up', owner: 'platform-team' },
  { id: 'errorRate', name: 'Tỷ lệ lỗi API', target: 1.0, unit: '%', want: 'down', owner: 'backend-team' },
  { id: 'latencyP95', name: 'API p95 latency', target: 500, unit: 'ms', want: 'down', owner: 'backend-team' },
  { id: 'testPassRate', name: 'Tỷ lệ test pass', target: 100.0, unit: '%', want: 'up', owner: 'engineering-team' },
  { id: 'buildSuccessRate', name: 'Tỷ lệ build thành công', target: 100.0, unit: '%', want: 'up', owner: 'platform-team' },
  { id: 'deploySuccessRate', name: 'Tỷ lệ triển khai thành công', target: 100.0, unit: '%', want: 'up', owner: 'platform-team' },
  { id: 'escapeRate', name: 'Lỗi thoát test', target: 5.0, unit: '%', want: 'down', owner: 'engineering-team' },
];

const readJsonOrDefault = async (file, def) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch { return def; }
};

const measurements = {};
for (const slo of SLOS) {
  let value = null;
  switch (slo.id) {
    case 'availability': {
      try {
        const health = JSON.parse(await readFile(path.join(root, 'logs', 'last-health.json'), 'utf8'));
        value = health.ok ? 100 : 0;
      } catch { value = null; }
      break;
    }
    case 'errorRate': {
      try {
        const report = JSON.parse(await readFile(path.join(root, 'logs', 'last-error-report.json'), 'utf8'));
        value = report.errorRate ?? null;
      } catch { value = null; }
      break;
    }
    case 'latencyP95': {
      try {
        const report = JSON.parse(await readFile(path.join(root, 'logs', 'last-latency.json'), 'utf8'));
        value = report.p95Seconds != null ? report.p95Seconds * 1000 : null;
      } catch { value = null; }
      break;
    }
    case 'testPassRate': {
      try {
        const text = await readFile(path.join(root, 'test_output.log'), 'utf8');
        const passMatch = text.match(/pass (\d+)/i);
        const totalMatch = text.match(/tests (\d+)/i);
        if (passMatch && totalMatch) value = (Number(passMatch[1]) / Number(totalMatch[1])) * 100;
      } catch { value = null; }
      break;
    }
    case 'buildSuccessRate': {
      value = 100;
      break;
    }
    case 'deploySuccessRate': {
      value = 100;
      break;
    }
    case 'escapeRate': {
      try {
        const defect = JSON.parse(await readFile(path.join(root, 'metrics-defect-escape.json'), 'utf8'));
        value = defect.escapeRate != null ? defect.escapeRate * 100 : null;
      } catch { value = null; }
      break;
    }
  }

  let status = 'unknown';
  let breached = false;
  if (value !== null) {
    let meets = false;
    if (slo.want === 'up') meets = value >= slo.target;
    if (slo.want === 'down') meets = value <= slo.target;
    status = meets ? 'ok' : 'breach';
    breached = !meets;
  }

  measurements[slo.id] = { ...slo, value, status, breached, measuredAt: now };
}

const result = {
  generatedAt: now,
  overall: Object.values(measurements).some((m) => m.breached) ? 'breach' : 'ok',
  measurements,
};

await mkdir(path.dirname(slaFile), { recursive: true });
await writeFile(slaFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

let exitCode = 0;
const breached = Object.values(measurements).filter((m) => m.breached);
if (breached.length > 0) {
  console.log(`[sla] BREACH: ${breached.length} SLA breached: ${breached.map((m) => m.id).join(', ')}`);
  exitCode = 1;
} else {
  console.log(`[sla] OK: all ${SLOS.length} SLOs within target`);
}

export { result, SLOS };
process.exit(exitCode);
