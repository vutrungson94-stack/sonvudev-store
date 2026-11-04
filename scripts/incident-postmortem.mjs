// Incident Postmortem — Quản lý sự cố sản xuất liên tục.
//
// Mỗi sự cố production phải có postmortem được ghi lại trong thư mục postmortems/
// trước khi có thể triển khai thay đổi tiếp theo.
//
//   npm run postmortem:new <tiêu đề>   tạo bản mẫu postmortem mới
//   npm run postmortem:check           kiểm tra tất cả sự cố mở có postmortem
//   npm run postmortem:resolve <file>  đánh dấu postmortem là resolved
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postmortemDir = path.join(root, 'postmortems');
const now = new Date().toISOString();

const requiredFields = [
  'title', 'date', 'impact', 'durationMinutes', 'detectedBy',
  'rootCause', 'correctiveActions', 'defectEscapedTests', 'escapeReason',
  'owner', 'dueDate', 'status',
];

const validStatuses = ['open', 'in-progress', 'resolved', 'closed'];

const slugify = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const readPostmortems = async () => {
  try { await readdir(postmortemDir); } catch { await mkdir(postmortemDir, { recursive: true }); return []; }
  const files = (await readdir(postmortemDir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const content = JSON.parse(await readFile(path.join(postmortemDir, f), 'utf8'));
      out.push({ file: f, ...content });
    } catch { out.push({ file: f, error: 'malformed-json' }); }
  }
  return out;
};

const postmortems = await readPostmortems();

const action = process.argv[2];
const title = process.argv.slice(3).join(' ');

if (action === 'new') {
  if (!title) {
    console.error('[postmortem:new] Cần cung cấp tiêu đề: npm run postmortem:new <tiêu đề>');
    process.exit(2);
  }
  const slug = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}`;
  const file = path.join(postmortemDir, `${slug}.json`);
  const template = {
    title,
    date: now,
    impact: '',
    durationMinutes: 0,
    detectedBy: '',
    rootCause: '',
    correctiveActions: [],
    defectEscapedTests: false,
    escapeReason: '',
    owner: '',
    dueDate: '',
    status: 'open',
  };
  await writeFile(file, JSON.stringify(template, null, 2) + '\n', 'utf8');
  console.log(`[postmortem:new] Đã tạo ${file}`);
  process.exit(0);
}

if (action === 'check') {
  const problems = [];
  const openIncidents = [];
  const resolvedWithoutRootCause = [];
  for (const pm of postmortems) {
    if (pm.error) { problems.push(`${pm.file}: malformed JSON`); continue; }
    for (const field of requiredFields) {
      if (pm[field] === undefined || pm[field] === null || pm[field] === '') {
        problems.push(`${pm.file}: missing field "${field}"`);
      }
    }
    if (!validStatuses.includes(pm.status)) problems.push(`${pm.file}: invalid status "${pm.status}"`);
    if (pm.correctiveActions && !Array.isArray(pm.correctiveActions)) {
      problems.push(`${pm.file}: correctiveActions must be an array`);
    }
    for (const action of Array.isArray(pm.correctiveActions) ? pm.correctiveActions : []) {
      if (!action || !action.owner || !action.dueDate || !action.description) {
        problems.push(`${pm.file}: corrective action missing owner/dueDate/description`);
      }
    }
    if (pm.status === 'open') openIncidents.push(pm.file);
    if (pm.status === 'resolved' && (!pm.rootCause || pm.rootCause.length < 10)) resolvedWithoutRootCause.push(pm.file);
  }
  const result = {
    generatedAt: now,
    totalPostmortems: postmortems.filter((p) => !p.error).length,
    openIncidents: openIncidents.length,
    resolvedWithoutRootCause: resolvedWithoutRootCause.length,
    problems,
  };
  await mkdir(path.dirname(path.join(root, 'metrics-postmortem.json')), { recursive: true });
  await writeFile(path.join(root, 'metrics-postmortem.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  let exitCode = 0;
  if (problems.length > 0) {
    console.log(`[postmortem:check] ${problems.length} vấn đề:`);
    for (const p of problems) console.log(`  - ${p}`);
    exitCode = 1;
  } else if (openIncidents.length > 0) {
    console.log(`[postmortem:check] ${openIncidents.length} sự cố mở chưa có postmortem:`);
    for (const f of openIncidents) console.log(`  - ${f}`);
    exitCode = 1;
  } else {
    console.log(`[postmortem:check] OK: ${result.totalPostmortems} postmortem, tất cả sự cố mở đã có báo cáo`);
  }
  process.exit(exitCode);
}

if (action === 'resolve') {
  const target = process.argv[3];
  if (!target) {
    console.error('[postmortem:resolve] Cần cung cấp tên file: npm run postmortem:resolve <file>');
    process.exit(2);
  }
  const file = path.join(postmortemDir, target);
  try {
    const content = JSON.parse(await readFile(file, 'utf8'));
    content.status = 'resolved';
    await writeFile(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
    console.log(`[postmortem:resolve] Đã đánh dấu ${file} là resolved`);
  } catch (e) {
    console.error(`[postmortem:resolve] Lỗi: ${e.message}`);
    process.exit(2);
  }
  process.exit(0);
}

console.error('[postmortem] Lệnh không hợp lệ. Dùng: new <tiêu đề> | check | resolve <file>');
process.exit(2);
