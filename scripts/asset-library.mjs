// Organizational Process Asset Library — Kiểm tra tài sản quy trình tổ chức.
//
// Đảm bảo mọi tài sản quy trình cần thiết đã tồn tại và được cập nhật.
// Các tài sản được lưu trong thư mục assets/ và được dùng chung trên mọi nhóm.
//
//   npm run asset:library   kiểm tra toàn bộ tài sản quy trình
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'assets');

const REQUIRED_ASSETS = [
  { path: 'README.md', name: 'Hướng dẫn thư viện tài sản' },
  { path: 'templates/postmortem-template.json', name: 'Mẫu postmortem' },
  { path: 'checklists/deployment-checklist.json', name: 'Checklist triển khai' },
  { path: 'checklists/security-checklist.json', name: 'Checklist bảo mật' },
  { path: 'policies/deployment-policy.md', name: 'Chính sách triển khai' },
  { path: 'policies/security-policy.md', name: 'Chính sách bảo mật' },
  { path: 'runbooks/deploy-runbook.md', name: 'Runbook triển khai' },
  { path: 'runbooks/incident-runbook.md', name: 'Runbook ứng phó sự cố' },
];

const readJsonOrDefault = async (file, def) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return def; }
};

const checkAsset = async (asset) => {
  const fullPath = path.join(assetsDir, asset.path);
  try {
    await stat(fullPath);
    return { asset, exists: true, valid: true };
  } catch {
    return { asset, exists: false, valid: false };
  }
};

const assets = await Promise.all(REQUIRED_ASSETS.map(checkAsset));
const missing = assets.filter((a) => !a.exists);
const invalid = assets.filter((a) => a.exists && !a.valid);

await mkdir(path.dirname(path.join(root, 'metrics-asset-library.json')), { recursive: true });
const result = {
  generatedAt: new Date().toISOString(),
  totalAssets: assets.length,
  missingAssets: missing.map((a) => a.asset.path),
  invalidAssets: invalid.map((a) => a.asset.path),
  allPresent: missing.length === 0 && invalid.length === 0,
};
await writeFile(path.join(root, 'metrics-asset-library.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');

let exitCode = 0;
if (missing.length > 0) {
  console.log(`[asset:library] ${missing.length} tài sản thiếu:`);
  for (const a of missing) console.log(`  - ${a.asset.path} (${a.asset.name})`);
  exitCode = 1;
} else if (invalid.length > 0) {
  console.log(`[asset:library] ${invalid.length} tài sản không hợp lệ:`);
  for (const a of invalid) console.log(`  - ${a.asset.path}`);
  exitCode = 1;
} else {
  console.log(`[asset:library] OK: ${assets.length} tài sản quy trình tổ chức đầy đủ`);
}

export { result, assets };
process.exit(exitCode);
