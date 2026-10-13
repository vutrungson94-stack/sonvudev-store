// Catches a workflow file that GitHub will refuse to run, before it is pushed.
//
// This gate exists because of a typo that cost two red runs and resisted being
// explained. A YAML comment is `#`. Someone wrote `//` at the start of a line
// inside a step list, which is not a comment in YAML at all — it is a token the
// grammar has no production for. GitHub will not parse the file, so it starts zero
// jobs, and the run finishes `conclusion: failure` with nothing in it: no jobs, no
// steps, no logs. The UI shows exactly what a red build shows, so the first move
// anyone makes with a red build — open the logs of the job that failed — is a dead
// end, because there are no jobs and there are no logs.
//
// Nothing else in this repository can see it, and that is the whole reason this
// file exists:
//   - `lint` reads JavaScript only, so a `.yml` file is invisible to it.
//   - the audit reads the workflow as *text*, hunting a hardcoded domain. That is
//     the right question and the wrong shape — it scans the file byte by byte
//     while "is this file well-formed" is a property of the file as a whole.
//   - the workflow guard tests read it as a string and regex-match the patterns
//     they care about (`secrets.APP_URL`, `exit 1`, no `continue-on-error`). All of
//     those are still there in a file that does not parse, because they are all
//     still just text.
//
// So every gate was green on a workflow that could not start a job. That is the
// class of failure this gate is for: the one where the repository signals health
// and the runner signals failure, with no way to attribute the disagreement.
//
// It deliberately has no dependency. `npm run metrics` counts every entry in
// `dependencies` and `devDependencies` and treats an increase as a regression, so a
// YAML parser would fail the build for a different reason on the same day. The
// checker below is therefore a small scanner, not a parser, and it is honest about
// it: it validates the subset of YAML workflow files actually use — block
// mappings, block sequences, flow sequences, block scalars and comments — and it
// reports what it can prove rather than claiming to parse YAML.
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(root, '.github', 'workflows');

// YAML forbids tabs in indentation outright. A file indented with a tab is a
// syntax error on every runner, and the editor that produced it usually looks fine.
const BLOCK = /^([|>])[+-]?\d*$/;   // "|", "|-", ">2" — block scalar indicator

const problems = [];

// Splits the logical lines of a workflow file, dropping block-scalar bodies so a
// shell script's content is never mistaken for YAML.
const logicalLines = (source) => {
  const out = [];
  let blockIndent = null;
  source.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const indent = line.length - line.replace(/^ +/, '').length;
    const content = line.slice(indent);
    if (blockIndent !== null) {
      // Still inside a `run: |` body — the first line that is not deeper than the
      // indicator ends it. Blank lines and comments inside it belong to the body.
      if (content === '' || indent > blockIndent) return;
      blockIndent = null;
    }
    out.push({ line: index + 1, indent, content });
    if (/^[A-Za-z_][^:]*:\s*$/.test(content) || BLOCK.test(content.trim()) || /:\s*[|>][+-]?\d*\s*$/.test(content)) {
      const indicator = content.trim().split(':').pop().trim();
      if (BLOCK.test(indicator)) blockIndent = indent;
    }
  });
  return out;
};

const checkOne = async (file) => {
  const relative = path.relative(root, file);
  const source = await readFile(file, 'utf8');
  const bad = [];

  // 1. Structural characters that only exist in other languages. A line starting
  //    with these cannot begin any YAML node.
  for (const line of logicalLines(source)) {
    const { content, line: number } = line;
    if (content === '' || content.startsWith('#')) continue;
    const body = content.startsWith('- ') ? content.slice(2) : content;
    if (/^\/\//.test(body) || /^\/\*/.test(body)) {
      bad.push(`${relative}:${number}: bắt đầu bằng ${body.slice(0, 2)} — comment của YAML là **#**, không phải // hay /*`);
      continue;
    }
    // 2. Stray closers: a line ending a construct that was never opened.
    if (/^[}\]]/.test(body)) {
      bad.push(`${relative}:${number}: dòng bắt đầu bằng ${body[0]} mà không mở gì — thụt lề/flow không cân`);
      continue;
    }
    // 3. Unbalanced flow collections or quotes on one line. `on: [push]` is fine;
    //    `node-version: ['20, '24']` is a parse error, and so is an odd number of
    //    double quotes.
    const flow = body.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/'(?:[^'\\]|\\.)*'/g, '');
    const quotes = (body.match(/"/g) || []).length;
    const open = (flow.match(/[[{]/g) || []).length;
    const close = (flow.match(/[\]}]/g) || []).length;
    if (open !== close) {
      bad.push(`${relative}:${number}: dấu ngoặc nhọn/flow không cân (${open} mở, ${close} đóng)`);
      continue;
    }
    if (quotes % 2 !== 0) {
      bad.push(`${relative}:${number}: số dấu nháy kép lẻ (${quotes}) — chuỗi chưa đóng`);
      continue;
    }
    // 4. A line that is not a comment, a sequence item, a mapping key or a plain
    //    scalar value. Everything in a workflow file is one of those four.
    const isMapping = /^[^\s:#][^:]*:(\s|$)/.test(body) || /^[A-Za-z_][\w.-]*:/.test(body);
    const isScalar = body.length > 0;
    if (!isMapping && !isScalar) bad.push(`${relative}:${number}: không nhận ra được dòng này`);
  }

  // 5. Tabs anywhere in the indentation.
  source.split('\n').forEach((raw, index) => {
    if (/^ *\t/.test(raw)) bad.push(`${relative}:${index + 1}: dùng TAB để thụt lề — YAML chỉ cho space`);
  });

  // 6. Shape. A workflow that scans clean but declares no `jobs` runs nothing, and
  //    a job with neither `steps` nor `uses` does nothing. Both are silent in a way
  //    a parse error is not.
  //
  // Scoped by line range, not by indent level. The first version of this check
  // compared indent widths across the whole file and read the `on:` list and the
  // `concurrency:` keys as job ids — twenty-six problems that were not problems.
  // A checker that reports false alarms is discarded on the first correct file, so
  // every block here is delimited by where it starts and where it ends.
  const lines = logicalLines(source).filter((l) => l.content && !l.content.startsWith('#'));

  /** The block that belongs to `parent`: every following line more indented, up to
   *  the first line back at or below the parent's own indent. */
  const childrenOf = (parent) => {
    const block = [];
    for (const line of lines) {
      if (line.line <= parent.line) continue;
      if (line.indent <= parent.indent) break;
      block.push(line);
    }
    return block;
  };
  /** The keys directly inside a block, i.e. those sharing its shallowest indent. */
  const keysOf = (block) => {
    if (!block.length) return [];
    const shallowest = Math.min(...block.map((l) => l.indent));
    return block.filter((l) => l.indent === shallowest);
  };

  // A key with a value (`name: checks`) and a key that only opens a block
  // (`jobs:`) are the same key, so compare the name before the colon rather than
  // the whole line.
  const topKeys = keysOf(lines.filter((l) => l.indent === 0));
  const keyName = (l) => l.content.split(':')[0].trim();
  for (const required of ['name', 'jobs']) {
    if (!topKeys.some((l) => keyName(l) === required)) {
      bad.push(`${relative}: thiếu khóa bắt buộc \`${required}\``);
    }
  }
  if (!topKeys.some((l) => keyName(l) === 'on' || keyName(l) === 'true')) {
    bad.push(`${relative}: thiếu trigger \`on\` (YAML đọc \`on:\` thành boolean \`true\` nên cả hai đều chấp nhận)`);
  }

  const jobsKey = topKeys.find((l) => keyName(l) === 'jobs');
  if (!jobsKey) return bad;

  const jobBlock = childrenOf(jobsKey);
  const jobLines = keysOf(jobBlock).filter((l) => l.content.endsWith(':') && /^[A-Za-z_][\w-]*:$/.test(l.content));
  if (!jobLines.length) bad.push(`${relative}: \`jobs\` không khai báo job nào`);

  for (const job of jobLines) {
    const id = job.content.slice(0, -1).trim();
    const props = keysOf(childrenOf(job));
    const names = props.map((p) => p.content.split(':')[0].trim());
    if (!names.includes('runs-on') && !names.includes('uses')) {
      bad.push(`${relative}:${job.line}: job \`${id}\` thiếu \`runs-on\` (hoặc \`uses\` nếu là reusable workflow)`);
    }
    if (!names.includes('steps') && !names.includes('uses')) {
      bad.push(`${relative}:${job.line}: job \`${id}\` thiếu \`steps\``);
      continue;
    }
    const stepsKey = props.find((p) => p.content === 'steps:');
    if (!stepsKey) continue;
    for (const item of keysOf(childrenOf(stepsKey)).filter((l) => l.content.startsWith('- '))) {
      const body = item.content.slice(2);
      const keyNames = /^[A-Za-z_][\w.-]*:/.test(body)
        ? [body.split(':')[0].trim(), ...keysOf(childrenOf(item)).map((l) => l.content.split(':')[0].trim())]
        : keysOf(childrenOf(item)).map((l) => l.content.split(':')[0].trim());
      if (!keyNames.includes('uses') && !keyNames.includes('run')) {
        bad.push(`${relative}:${item.line}: step không có \`uses\` cũng không có \`run\` — nó không làm gì cả`);
      }
    }
  }

  return bad;
};

let files = [];
try {
  files = (await readdir(workflowsDir)).filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join(workflowsDir, f));
} catch {
  console.error('[workflow] FAIL: không đọc được .github/workflows/');
  process.exit(1);
}
if (!files.length) {
  console.error('[workflow] FAIL: .github/workflows/ không có file .yml nào');
  process.exit(1);
}

for (const file of files) problems.push(...(await checkOne(file)));

if (problems.length) {
  console.error(`[workflow] FAIL: ${problems.length} vấn đề trong .github/workflows/:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  console.error('Một workflow lỗi cú pháp không chạy job nào cả: run kết thúc "failure" mà không có job,');
  console.error('không có log để đọc — nhìn y như một build đỏ bình thường. Đó là lý do gate này tồn tại.');
  process.exit(1);
}
console.log(`[workflow] PASS: ${files.length} workflow đọc được, cú pháp đủ sạch và có đủ jobs + steps.`);
