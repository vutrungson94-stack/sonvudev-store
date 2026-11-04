// Postmortem / root-cause analysis process.
//
// A Level 5 platform does not just fix incidents — it learns from them. Every
// production incident must have a postmortem with:
//   - what happened (symptoms, impact, duration)
//   - why it happened (root cause, not just proximate cause)
//   - how it was detected (monitoring, customer report, etc.)
//   - corrective actions with owners and due dates
//   - whether the defect escaped tests, and why
//
//   npm run postmortem:new  create a new postmortem template
//   npm run postmortem:check verify all open incidents have postmortems
//
// Postmortems live in postmortems/ as JSON files named YYYY-MM-DD-slug.json.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postmortemDir = path.join(root, 'postmortems');
const now = new Date().toISOString();

const requiredFields = [
  'title',
  'date',
  'impact',
  'durationMinutes',
  'detectedBy',
  'rootCause',
  'correctiveActions',
  'defectEscapedTests',
  'escapeReason',
  'owner',
  'dueDate',
  'status',
];

const validStatuses = ['open', 'in-progress', 'resolved', 'closed'];

const readPostmortems = async () => {
  try {
    await readdir(postmortemDir);
  } catch {
    await mkdir(postmortemDir, { recursive: true });
    return [];
  }
  const files = (await readdir(postmortemDir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const content = JSON.parse(await readFile(path.join(postmortemDir, f), 'utf8'));
      out.push({ file: f, ...content });
    } catch {
      // malformed — report as invalid
      out.push({ file: f, error: 'malformed-json' });
    }
  }
  return out;
};

const postmortems = await readPostmortems();

const problems = [];
for (const pm of postmortems) {
  if (pm.error) {
    problems.push(`${pm.file}: malformed JSON`);
    continue;
  }
  for (const field of requiredFields) {
    if (pm[field] === undefined || pm[field] === null || pm[field] === '') {
      problems.push(`${pm.file}: missing required field "${field}"`);
    }
  }
  if (!validStatuses.includes(pm.status)) {
    problems.push(`${pm.file}: invalid status "${pm.status}"`);
  }
  if (pm.correctiveActions && !Array.isArray(pm.correctiveActions)) {
    problems.push(`${pm.file}: correctiveActions must be an array`);
  }
  for (const action of pm.correctiveActions || []) {
    if (!action.owner || !action.dueDate || !action.description) {
      problems.push(`${pm.file}: corrective action missing owner/dueDate/description`);
    }
  }
}

const openIncidents = postmortems.filter((pm) => !pm.error && pm.status === 'open');
const resolvedWithoutRootCause = postmortems.filter(
  (pm) => !pm.error && pm.status === 'resolved' && (!pm.rootCause || pm.rootCause.length < 10),
);

const result = {
  generatedAt: now,
  totalPostmortems: postmortems.filter((pm) => !pm.error).length,
  openIncidents: openIncidents.length,
  resolvedWithoutRootCause: resolvedWithoutRootCause.length,
  problems,
  postmortems,
};

await mkdir(path.dirname(path.join(root, 'metrics-postmortem.json')), { recursive: true });
await writeFile(
  path.join(root, 'metrics-postmortem.json'),
  JSON.stringify(result, null, 2) + '\n',
  'utf8',
);

let exitCode = 0;
if (problems.length > 0) {
  console.log(`[postmortem] ${problems.length} validation problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  exitCode = 1;
} else if (openIncidents.length > 0) {
  console.log(
    `[postmortem] ${openIncidents.length} open incident(s) without postmortem — all production incidents require a postmortem before deploy`,
  );
  exitCode = 1;
} else {
  console.log(
    `[postmortem] OK: ${result.totalPostmortems} postmortem(s), all open incidents have postmortems`,
  );
}

export { result, postmortems, problems };
process.exit(exitCode);
