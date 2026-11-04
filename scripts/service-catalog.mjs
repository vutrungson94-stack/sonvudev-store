// Service catalog — organizational-level process asset.
//
// A Level 5 platform maintains a catalog of every service it runs, who owns it,
// what SLOs it must meet, and its golden path for changes. This is not just
// documentation — it is machine-readable and enforced by the build gates.
//
//   npm run catalog:check   verify every service in the catalog is accounted for
//   npm run catalog:new     create a new service entry template
//
// Entries live in services/ as JSON files named <service-id>.json.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = path.join(root, 'services');
const now = new Date().toISOString();

const requiredFields = [
  'id',
  'name',
  'owner',
  'repository',
  'type',
  'slo',
  'goldenPath',
  'lifecycle',
];

const readCatalog = async () => {
  try {
    await readdir(catalogDir);
  } catch {
    await mkdir(catalogDir, { recursive: true });
    return [];
  }
  const files = (await readdir(catalogDir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const content = JSON.parse(await readFile(path.join(catalogDir, f), 'utf8'));
      out.push({ file: f, ...content });
    } catch {
      out.push({ file: f, error: 'malformed-json' });
    }
  }
  return out;
};

const services = await readCatalog();

const problems = [];
const serviceIds = new Set();
for (const svc of services) {
  if (svc.error) {
    problems.push(`${svc.file}: malformed JSON`);
    continue;
  }
  for (const field of requiredFields) {
    if (svc[field] === undefined || svc[field] === null || svc[field] === '') {
      problems.push(`${svc.file}: missing required field "${field}"`);
    }
  }
  if (serviceIds.has(svc.id)) {
    problems.push(`${svc.file}: duplicate service id "${svc.id}"`);
  }
  serviceIds.add(svc.id);
  if (!['web', 'worker', 'cron', 'library'].includes(svc.type)) {
    problems.push(`${svc.file}: invalid type "${svc.type}"`);
  }
  if (!['development', 'staging', 'production', 'deprecated'].includes(svc.lifecycle)) {
    problems.push(`${svc.file}: invalid lifecycle "${svc.lifecycle}"`);
  }
}

const result = {
  generatedAt: now,
  totalServices: services.filter((s) => !s.error).length,
  problems,
  services,
};

await mkdir(path.dirname(path.join(root, 'metrics-service-catalog.json')), { recursive: true });
await writeFile(
  path.join(root, 'metrics-service-catalog.json'),
  JSON.stringify(result, null, 2) + '\n',
  'utf8',
);

let exitCode = 0;
if (problems.length > 0) {
  console.log(`[catalog] ${problems.length} validation problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  exitCode = 1;
} else {
  console.log(`[catalog] OK: ${result.totalServices} service(s) catalogued`);
}

export { result, services, problems };
process.exit(exitCode);
