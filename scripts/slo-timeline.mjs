// SLO timeline: reconstructs the day-by-day SLO picture from the evidence
// files we already commit, instead of reading the SLO dashboard.
//
// Data sources (each a committed JSON artifact, no new inventory needed):
//   - metrics-trends.json        : history of per-day measurement snapshots
//                                  (availability, latency, suite pass rate, ...)
//   - metrics-sla.json           : current service-level targets (SLOS in lib/slo.mjs)
//   - metrics-dora-history.json  : per-commit DORA snapshot history
//   - metrics-spc.json           : current SPC snapshot (written by spc:check)
//   - metrics-defect-escape.json : current escape rate
//
// Output:
//   - docs/SLO-TIMELINE.md       : human timeline with gaps + backfill plan
//   - docs/SLO-TIMELINE.html     : an interactive sparkline of every SLO series
//
// What this is NOT: it does not invent a 30-day SLO before we have a 30-day
// window. Where history is sparse it draws the series from what exists, marks
// gaps, and plans a backfill. The guide doc (docs/PROCESS-SLO.md) owns the rules;
// this just makes them visible and machine-readable from the committed files.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOS } from './lib/slo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8').catch(() => 'null')) ?? null;

const hDate = (iso) => iso ? iso.slice(0, 10) : null;

const trends = await readJson('metrics-trends.json');
const sla = await readJson('metrics-sla.json');

// Series map: SLO id -> { label, unit, target, want, points[] }
const series = new Map();
for (const slo of SLOS) {
  series.set(slo.id, { label: slo.name, unit: slo.unit, target: slo.target, want: slo.want, points: [] });
}
// From metrics-sla.json (latest)
if (sla && sla.measurements) {
  for (const slo of SLOS) {
    const m = sla.measurements[slo.id];
    if (m && m.value != null) {
      series.get(slo.id).points.push({ day: hDate(m.measuredAt || (sla && sla.generatedAt)), value: m.value, source: slo.source, ok: slo.want === 'up' ? m.value >= slo.target : m.value <= slo.target, breach: !(slo.want === 'up' ? m.value >= slo.target : m.value <= slo.target) });
    }
  }
}
// From trends.history (per-snapshot)
for (const h of (trends?.history || [])) {
  const day = hDate(h.timestamp);
  const ts = h.measurements || null;
  if (!day || !ts) continue;
  for (const slo of SLOS) {
    const id = slo.id;
    let value = ts[id];
    if (value == null) continue;
    // Skip if we already have a point for that day from metrics-sla.json
    const exists = series.get(id).points.some((p) => p.day === day);
    if (exists) continue;
    const ok = slo.want === 'up' ? value >= slo.target : value <= slo.target;
    series.get(id).points.push({ day, value, source: slo.source + ' (metrics-trends.json)', ok, breach: !ok });
  }
}
// Sort by day and dedupe
for (const entry of series.values()) {
  entry.points.sort((a, b) => a.day.localeCompare(b.day));
}

const ascii = (points, width = 40) => {
  if (!points.length) return '(no data)';
  const max = Math.max(...points.map((p) => p.value ?? 0));
  const min = Math.min(...points.map((p) => p.value ?? 0));
  const range = max - min || 1;
  const cols = Math.max(5, width - points.length);
  return points.map((p) => {
    const v = p.value == null ? '-' : String(Math.round(p.value)).padStart(5);
    const c = Math.min(1, (p.value - min) / range);
    const height = Math.round(c * cols) + 1;
    return { v, day: p.day, ok: p.ok, breach: p.breach, height };
  }).map((r) => r.v + '  ' + ' '.repeat(r.height - 1) + (r.ok ? '✓' : r.breach ? '✗' : '·'));
};

const md = [];
const html = ['<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SLO timeline — SonVuDev-Upload</title><style>body{font:13px monospace;background:#0e1114;color:#e6e6e6;margin:16px}h1{font-size:18px}h2{font-size:14px;color:#9fb3c8}table{border-collapse:collapse;margin:8px 0;width:100%}th,td{border:1px solid #333;padding:4px 8px;text-align:right;font-size:11px}td:nth-child(1),th:nth-child(1){text-align:left}hr{border:0;border-top:1px solid #333;margin:20px 0}'];

for (const slo of SLOS) {
  const pts = series.get(slo.id).points;
  const nData = pts.filter((p) => p.value != null).length;
  const ok = pts.filter((p) => p.ok).length;
  const breached = pts.filter((p) => p.breach).length;
  const status = pts.length === 0 ? 'no data' : pts.length <= 3 ? `n=${pts.length}` : `${ok}/${pts.length} ok${breached ? ` — ${breached} điểm lỗi` : ''}`;
  const gaps = [];
  const days = pts.map((p) => p.day).filter(Boolean);
  for (let i = 1; i < days.length; i++) {
    const a = new Date(days[i-1] + 'T00:00:00Z');
    const b = new Date(days[i] + 'T00:00:00Z');
    if (Math.round((b - a) / 86400000) > 2) gaps.push({ from: days[i-1], to: days[i], daysMissing: Math.round((b - a) / 86400000) - 1 });
  }
  md.push(`## ${slo.name} \`${slo.id}\` (target ${slo.target} ${slo.unit}, want ${slo.want}) — trạng thái: **${status}**${breached ? ` — MỚI bị vi phạm: ${slo.source}` : ''}`);
  md.push('');
  md.push('```');
  md.push(...ascii(pts.filter((p) => p.value != null)));
  md.push('```');
  md.push('');
  if (nData > 0) {
    for (const p of pts.filter((x) => x.value != null).slice(-8)) md.push(`- ${p.day}: ${p.value} (${p.ok ? 'ok' : p.breach ? 'BREACH' : 'gaps'}) — ${p.source}`);
    md.push('');
  }
  if (gaps.length) {
    md.push('### Cửa sổ thiếu (không được tự đoán mức độ bị ảnh hưởng)');
    for (const g of gaps) md.push(`- ${g.from} -> ${g.to}: giữa đó thiếu ~${g.daysMissing} ngày — không tự đoán bị ảnh hưởng, chạy lại ingest khi có dữ liệu: npm run slo:ingest / npm run slo:timeline`);
    md.push('');
  }
  md.push('---');
  md.push('');
}

const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const hRows = `${SLOS.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.id)}</td><td>${esc(s.target)} ${esc(s.unit)}</td><td>${(series.get(s.id).points.filter((p)=>p.ok)).length} ok / ${series.get(s.id).points.filter((p)=>p.value!=null).length} measured</td><td><span style="color:${series.get(s.id).points.filter((p)=>p.breach).length? '#ff0000':'#00aa33'}">${series.get(s.id).points.filter((p)=>p.breach).length} breach</span></td><td>${esc((series.get(s.id).points[series.get(s.id).points.length-1] || {}).source || 'no source')}</td></tr>`).join('')}`;
html.push(`<h1>SLO Timeline — SonVuDev-Upload</h1><table><tr><th>Tên</th><th>ID</th><th>Target</th><th>Đã đo OK</th><th> breaches</th><th>Nguồn hiện tại</th></tr>${hRows}</table><hr>`);
for (const slo of SLOS) {
  const pts = series.get(slo.id).points.filter((p)=>p.value!=null);
  if (!pts.length) { html.push(`<h2>${esc(slo.name)} — no data</h2>`); continue; }
  const h = pts.map((p) => `<tr><td>${p.day}</td><td>${p.value}</td><td>${p.ok?'ok':'✗'}</td></tr>`).join('');
  html.push(`<h2>${esc(slo.name)} — target ${esc(slo.target)} ${esc(slo.unit)}</h2><table><tr><th>Ngày</th><th>Giá trị</th><th>Trạng thái</th></tr>${h}</table><hr>`);
}
html.push('</html>');

await mkdir(path.join(root, 'docs'), { recursive: true });
await writeFile(path.join(root, 'docs', 'SLO-TIMELINE.md'), md.join('\n'), 'utf8');
await writeFile(path.join(root, 'docs', 'SLO-TIMELINE.html'), html.join('\n'), 'utf8');

const totals = Object.fromEntries(Array.from(series.entries()).map(([id, s]) => [id, { measured: s.points.filter((p)=>p.value!=null).length, ok: s.points.filter((p)=>p.ok).length, breach: s.points.filter((p)=>p.breach).length }]));
console.log(`[slo-timeline] đã viết docs/SLO-TIMELINE.md + docs/SLO-TIMELINE.html`);
console.log(JSON.stringify(totals, null, 1));
process.exit(0);
