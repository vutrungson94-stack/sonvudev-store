import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The audit is the thing that keeps the hardcodes, the dead translation keys and
// the broken links from coming back, so it has to be tested the same way as the
// code it checks: by running it and reading what it says.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The script itself stays in the repository so its own imports resolve; --root
// points it at the copy being broken, which is the only way to make each check
// fail on demand without breaking the real tree.
//
// APP_URL and SUPPORT_EMAIL are supplied here rather than read from the developer's
// .env. The audit compares files against these two values and refuses to run
// without them, so a test that depended on a local .env would pass on this
// machine and fail on a fresh clone. The domain used below is the point of case 5.
const AUDIT_DOMAIN = 'https://audit-fixture.example';
const AUDIT_EMAIL = 'support-ao@audit-fixture.example';
const runAudit = (root = projectRoot) => spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'audit-web.mjs'), '--root', root], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'test', APP_URL: AUDIT_DOMAIN, SUPPORT_EMAIL: AUDIT_EMAIL },
});

test('audit chạy sạch trên chính dự án này', () => {
  const result = runAudit();
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, `audit phải sạch:\n${output}`);
  assert.match(result.stdout, /\[audit\] PASS/);
});

test('audit chặn được từng loại lỗi nó sinh ra để bắt', async () => {
  // Each case breaks one thing in a copy of the repository and expects the audit
  // to name it. A check that cannot be made to fail is a check that does nothing.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-audit-'));
  const copy = async (name) => {
    const target = path.join(dir, name);
    await fs.cp(path.join(projectRoot, 'public'), path.join(target, 'public'), { recursive: true });
    await fs.cp(path.join(projectRoot, 'src'), path.join(target, 'src'), { recursive: true });
    return target;
  };

  // 1. A link to a file that does not exist.
  {
    const cwd = await copy('broken-link');
    await fs.writeFile(path.join(cwd, 'public', 'index.html'), '<a href="/khong-ton-tai.html">x</a>', 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /link gãy.*khong-ton-tai/s, output);
  }

  // 2. The same Express route registered twice. Express answers with the first
  //    one, so the second is dead code that reads as if it works.
  {
    const cwd = await copy('duplicate-route');
    const file = path.join(cwd, 'src', 'app.js');
    await fs.appendFile(file, '\napp.get("/robots.txt", (_req, res) => res.send("x"));\n', 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /route trùng.*robots\.txt/s, output);
  }

  // 3. A translation key nothing renders.
  {
    const cwd = await copy('orphan-key');
    const file = path.join(cwd, 'public', 'i18n.js');
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace("'brand.tagline':", "'khac.dead': 'Không ai dùng',\n    'brand.tagline':"), 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /khoá i18n mồ côi.*khac\.dead/s, output);
  }

  // 4. A key present in Vietnamese and missing in English, which is how the two
  //    languages drift apart without either file noticing.
  {
    const cwd = await copy('missing-translation');
    const file = path.join(cwd, 'public', 'i18n.js');
    const source = await fs.readFile(file, 'utf8');
    const cut = source.replace(/\n\s*'brand\.tagline': 'Phần mềm tốt cho công việc tốt\.',/, '');
    assert.notEqual(cut.length, source.length, 'phải tìm được dòng tiếng Việt để xoá');
    await fs.writeFile(file, cut, 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /thiếu bản dịch.*brand\.tagline/s, output);
  }

// 5. The site's own domain written into a file instead of coming from APP_URL.
  {
    const cwd = await copy('hardcoded-domain');
    const file = path.join(cwd, 'public', 'index.html');
    const source = await fs.readFile(file, 'utf8');
    // The same origin APP_URL was given above, because the point is that a file
    // repeating the real domain is what gets caught.
    await fs.writeFile(file, source.replace('<link rel="icon"', `<link rel="preconnect" href="${AUDIT_DOMAIN}">\n<link rel="icon"`), 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /domain gõ tay.*index\.html/s, output);
    assert.match(output, /\{\{site\}\}|APP_URL/, 'lỗi phải chỉ ra cách sửa');
  }

  // 5b. The audit itself must not be able to pass while unconfigured. It used to
  //     fall back to the shop's own domain and support address, so with APP_URL
  //     unset it compared the files against a constant, found that constant in the
  //     homepage's own JSON-LD, and reported itself clean.
  {
    const cwd = await copy('unconfigured-audit');
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'audit-web.mjs'), '--root', cwd], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_URL: '', SUPPORT_EMAIL: '' },
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'audit thiếu cấu hình phải FAIL');
    assert.match(output, /cau hinh thieu.*APP_URL/s, output);
    assert.match(output, /cau hinh thieu.*SUPPORT_EMAIL/s, output);
  }

  // 5c. A template token nothing substitutes. {{legalEntity}} was added to the
  //     terms page and to config in the same change, and never wired to the
  //     renderer — so the page would have printed "{{legalEntity}}" at a buyer
  //     deciding whether to trust the shop. Nothing threw, nothing was logged.
  {
    const cwd = await copy('unwired-token');
    const file = path.join(cwd, 'public', 'terms.html');
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace('<body>', '<body><p>{{chuaCoAiDien}}</p>'), 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'token không được điền phải FAIL');
    assert.match(output, /token chua noi.*chuaCoAiDien/s, output);
  }

  // 6. Structured data aimed at a page robots.txt forbids.
  {
    const cwd = await copy('schema-blocked');
    const file = path.join(cwd, 'src', 'pages.js');
    const source = await fs.readFile(file, 'utf8');
    assert.ok(source.includes('Disallow') === false, 'sanity: pages.js không chứa robots');
    await fs.appendFile(file, '\nexport const broken = { "urlTemplate": `${site()}/lookup?q={search_term_string}` };\n', 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /schema chặn.*\/lookup/s, output);
  }

  // 7. A page nothing links to: live in the folder, unreachable from the site.
  {
    const cwd = await copy('orphan-page');
    const file = path.join(cwd, 'public', 'orphan.html');
    await fs.writeFile(file, '<!doctype html><html><body><h1>Trang không ai tới</h1></body></html>', 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /trang mồ côi.*orphan\.html/s, output);
  }

  await fs.rm(dir, { recursive: true, force: true });
});

test('file xác minh còn tồn tại sau khi thêm các kiểm tra mới', () => {
  assert.ok(existsSync(path.join(projectRoot, 'public', 'favicon.svg')));
  assert.ok(!existsSync(path.join(projectRoot, 'public', 'logo.svg')), 'không được tạo lại file logo đã bị bỏ');
  assert.ok(!existsSync(path.join(projectRoot, 'server.js')), 'shim server.js ở thư mục gốc là code mồ côi');
});

// A command that cannot work.
//
// npm 11 swallows a bare flag even after the `--` separator: it prints "Expanding
// --update to --update-notifier" and runs the script without it. So
// A flag written after the `--` separator wrote nothing to Render while printing a
// list of four changes as if it had, and production kept its sandbox PayPal creds.
// Nothing in the output said the flag had been eaten.
//
// The fix is that every flagged operation has its own entry in package.json, so the
// flag is written by the repository rather than typed past a `--` that no longer
// works. This keeps anyone from documenting the old form again — including inside a
// script's own help text, which is exactly where someone reads it once something
// has already gone wrong.
test('không còn lệnh npm run nào dùng "-- --cờ"', async () => {
  const flagged = /npm run [\w:.-]+\s+--\s+--[a-z]/i;
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'publish-output') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(js|mjs|md|json|yml|html)$/.test(entry.name)) {
        const relative = path.relative(projectRoot, full).split(path.sep).join('/');
        const source = await fs.readFile(full, 'utf8');
        for (const [index, line] of source.split(/\r?\n/).entries()) {
          // The old form survives in exactly one place: the paragraph that
          // explains why it no longer works, quoted on purpose.
          if (relative === 'README.md' && /bị npm nuốt mất/.test(line)) continue;
          if (flagged.test(line)) offenders.push(`${relative}:${index + 1}`);
        }
      }
    }
  };
  await walk(projectRoot);
  assert.deepEqual(offenders, [], `dung ten script co san thay vi hien thuc co ghep sau dau "--": ${offenders.join(', ')}`);

  // And each flagged operation really does have an entry that carries its flag,
  // so the fix is not just removing the documentation and leaving nothing behind.
  const scripts = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')).scripts;
  for (const required of ['metrics:update', 'render:sync:apply', 'render:sync:deploy', 'render:deploy', 'db:migrate:apply', 'paypal:detect']) {
    assert.ok(scripts[required], `package.json thiếu script "${required}"`);
    assert.ok(/(^|\s)--[a-z-]+/.test(scripts[required]), `"${required}" phải tự mang cờ`);
  }
});
