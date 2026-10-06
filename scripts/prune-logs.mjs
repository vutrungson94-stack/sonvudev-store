// Xoay vòng logs/ local: giữ N file mới nhất, xóa .pid chết.
// logs/ đã gitignored nên đây chỉ là vệ sinh máy dev/VM, không ảnh hưởng deploy.
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs');
const keep = Math.max(1, Number.parseInt(process.argv[2] || process.env.LOG_KEEP || '10', 10) || 10);

let entries = [];
try {
  entries = await readdir(dir);
} catch {
  console.log('[logs] PASS: không có thư mục logs/, không cần xoay vòng.');
  process.exit(0);
}
const withTime = [];
for (const name of entries) {
  if (name === '.gitkeep') continue;
  try {
    const st = await stat(path.join(dir, name));
    withTime.push({ name, mtime: st.mtimeMs });
  } catch { /* file biến mất giữa chừng */ }
}
withTime.sort((a, b) => b.mtime - a.mtime);
const stale = withTime.slice(keep);
for (const { name } of stale) {
  await rm(path.join(dir, name), { force: true, recursive: true });
}
console.log(`[logs] PASS: giữ ${Math.min(keep, withTime.length)} file mới nhất, đã xóa ${stale.length} file cũ trong logs/.`);
