import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

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
  // Only the directories a case actually reads.
  //
  // Every case used to get the whole tree — public, src, scripts, test and deploy —
  // and a copy is the dominant cost of this file: the audit itself runs in under two
  // seconds, so thirty full copies is a minute of the suite spent moving files that
  // most cases never look at. Naming the directories turns a six-second case into a
  // one-second one, and the difference grows with the size of the project rather than
  // with the number of checks.
  const copy = async (name, dirs = ['public', 'src', 'scripts', 'test', 'deploy']) => {
    const target = path.join(dir, name);
    for (const extra of dirs) {
      await fs.cp(path.join(projectRoot, extra), path.join(target, extra), { recursive: true });
    }
    await fs.cp(path.join(projectRoot, '.env.example'), path.join(target, '.env.example'));
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
    // The anchor is the page's icon block, and the page's icon block is now a
    // {{iconLinks}} token rather than a written-out <link rel="icon">. This test
    // used to replace that literal, and when the literal moved the replace became a
    // no-op: nothing was injected, the fixture was clean, and the audit correctly
    // reported no hardcoded domain. The test asserted "phải FAIL" and got a pass,
    // because a fixture that was never broken cannot fail. So the anchor is asserted
    // before it is replaced — a silent no-op is now a loud failure instead of a test
    // that quietly stops testing.
    const anchor = '{{iconLinks}}';
    assert.ok(source.includes(anchor),
      `index.html phải còn "${anchor}" để test này còn chỗ cắm domain — nếu token đổi tên, sửa cả hai`);
    const injected = source.replace(anchor, `<link rel="preconnect" href="${AUDIT_DOMAIN}">\n${anchor}`);
    assert.notEqual(injected, source, 'việc chèn domain phải thực sự thay đổi file');
    await fs.writeFile(file, injected, 'utf8');
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
    // A missing APP_URL is not a failure any more, and that is the point.
    //
    // It used to be, and it was wrong everywhere except production. A fresh clone has
    // no .env, so the first command anybody runs after cloning failed on two lines
    // about configuration — and a person who had just seen the suite pass elsewhere
    // was told the audit did not work. The failure said nothing about the code.
    //
    // Now the checks that need a domain are skipped and named, and the rest still
    // run. Which means the test has to prove the skipping, not just the passing: an
    // audit that quietly did less would be indistinguishable from one that was fine.
    assert.equal(result.status, 0, `thiếu cấu hình thì các nhóm còn lại vẫn phải chạy:\n${output}`);
    assert.match(output, /Bo qua \d+ nhom vi thieu cau hinh/, 'phải nói rõ đã bỏ qua gì');
    assert.match(output, /APP_URL/, 'phải nói tên biến còn thiếu');
    assert.match(output, /SUPPORT_EMAIL/, 'phải nói tên biến còn thiếu');
    assert.match(output, /\[audit\] PASS/, 'các nhóm không phụ thuộc cấu hình vẫn phải chạy hết');
    // And with the values present it is exactly as strict as before — except for
    // the one documented exception: AUDIT_DOMAIN is a fixture host by design, and
    // the R2 CORS group deliberately skips on a fixture host rather than comparing
    // the shop's real origin list against a throwaway domain. So "configured"
    // means exactly that one named skip and nothing else: any new skip, or any
    // finding, still fails here.
    const configured = runAudit(cwd);
    const configuredOutput = `${configured.stdout}${configured.stderr}`;
    assert.equal(configured.status, 0, `có cấu hình thì phải sạch:\n${configuredOutput}`);
    const skips = [...configured.stdout.matchAll(/Bo qua \d+ nhom vi thieu cau hinh: ([^\n]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(skips, ['R2 CORS khớp APP_URL (APP_URL là giá trị giả)'], `có cấu hình thì chỉ được bỏ qua đúng nhóm R2 đã nêu danh, không thêm không bớt:\n${configured.stdout}`);
  }

  // 5c. A template token nothing substitutes. {{legalEntity}} was added to the
  //     terms page and to config in the same change, and never wired to the
  //     renderer — so the page would have printed "{{legalEntity}}" at a buyer
  //     deciding whether to trust the shop. Nothing threw, nothing was logged.
  // The replacement is written against the opening <body> tag itself rather than the
  // literal `<body>`, because terms.html stopped being exactly that when it gained a
  // data-support attribute for the dictionary. Anchoring on the tag name makes this
  // survive the next attribute that lands on it — and a check that silently stops
  // injecting its fault reports nothing at all, which is worse than a missing one.
  {
    const cwd = await copy('unwired-token');
    const file = path.join(cwd, 'public', 'terms.html');
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace(/<body[^>]*>/, '<body><p>{{chuaCoAiDien}}</p>'), 'utf8');
    const result = runAudit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'token không được điền phải FAIL');
    assert.match(output, /token chưa nối.*chuaCoAiDien/s, output);
  }

  // 5d. The R2 CORS group on a host it can actually judge. Every run above uses
  //     a fixture APP_URL, on which this group skips by design — so until now no
  //     test had ever seen it pass or fail, and a check nobody exercises is a
  //     check that can rot unnoticed. The domain below is fake but deliberately
  //     not a fixture (.example is exactly what triggers the documented skip),
  //     following the same precedent as the corsDiff unit tests.
  {
    const cwd = await copy('r2-cors-positive');
    const { requiredOrigins } = await import('../scripts/lib/cors.mjs');
    const appUrl = 'https://r2check.example.org';
    await fs.cp(path.join(projectRoot, 'cloudflare'), path.join(cwd, 'cloudflare'), { recursive: true });
    const origins = requiredOrigins(appUrl);
    const rule = [{ AllowedOrigins: origins, AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedHeaders: ['Content-Type'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 900 }];
    await fs.writeFile(path.join(cwd, 'cloudflare', 'r2-cors.json'), JSON.stringify(rule, null, 2));
    const runWith = () => spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'audit-web.mjs'), '--root', cwd], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_URL: appUrl, SUPPORT_EMAIL: AUDIT_EMAIL },
    });
    const ok = runWith();
    const okOutput = `${ok.stdout}${ok.stderr}`;
    assert.equal(ok.status, 0, `CORS khớp APP_URL thì phải sạch:\n${okOutput}`);
    assert.ok(!/Bo qua/.test(ok.stdout), 'không phải fixture thì không được bỏ qua nhóm nào');
    // And a stale file must fail naming the repair, not pass quietly.
    const stale = [...origins.filter((origin) => !origin.includes('r2check')), 'https://cu-ten-mien.example.net'];
    rule[0].AllowedOrigins = stale;
    await fs.writeFile(path.join(cwd, 'cloudflare', 'r2-cors.json'), JSON.stringify(rule, null, 2));
    const bad = runWith();
    const badOutput = `${bad.stdout}${bad.stderr}`;
    assert.equal(bad.status, 1, 'thiếu origin phải FAIL');
    assert.match(badOutput, /R2 CORS lệch.*r2check/s, badOutput);
    assert.match(badOutput, /r2:cors:write/, 'lỗi phải chỉ ra cách sửa');
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

// Unaccented Vietnamese is not illegible, so it survives: it reads as written,
// just wrong, and only someone who already knows the correct spelling notices.
// It accumulated in scripts/ and test/ — the text read when something is wrong —
// because the check only ever looked at the storefront. A customer would have
// spotted it at once.
test('tiếng Việt mất dấu trong scripts và test cũng bị bắt', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-diacritics-'));
  const copy = async (name) => {
    const target = path.join(dir, name);
    await fs.cp(path.join(projectRoot, 'public'), path.join(target, 'public'), { recursive: true });
    await fs.cp(path.join(projectRoot, 'src'), path.join(target, 'src'), { recursive: true });
    for (const extra of ['scripts', 'test', 'deploy']) {
      await fs.cp(path.join(projectRoot, extra), path.join(target, extra), { recursive: true });
    }
    await fs.cp(path.join(projectRoot, '.env.example'), path.join(target, '.env.example'));
    return target;
  };
  const audit = (cwd) => runAudit(cwd);

  // A script that cannot find an order. The bare spelling of a phrase that exists
  // accented elsewhere in the project, which is the only kind of evidence the check
  // needs — it does not know Vietnamese, it knows this project's own words, read out
  // of the storefront and the server. A phrase that only appears in a test file is
  // not in that table, and inventing one for the fixture would have tested nothing.
  {
    const cwd = await copy('script');
    await fs.appendFile(path.join(cwd, 'scripts', 'build-web.mjs'), '\nconsole.error("Khong tim thay don hang nay");\n', 'utf8');
    const result = audit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /tiếng Việt không dấu.*Khong tim thay/s, output);
    // The file is named, so the person who wrote it knows where to look.
    assert.match(output, /scripts[/\\]build-web\.mjs/, output);
    // And the correct spelling is handed to them rather than left to guesswork.
    assert.match(output, /viết đúng là "Không tìm thấy/, output);
  }

  // The same mistake in a test title, which is what someone reads when a run is red.
  // A different phrase, and one that only exists accented in the storefront rather
  // than in src/ — so this also proves the vocabulary is read from both, and not
  // only from the server the previous case happened to quote.
  {
    const cwd = await copy('test');
    await fs.appendFile(path.join(cwd, 'test', 'probe.test.js'), "\ntest('can tro giup khi khong tai duoc file', () => {});\n", 'utf8');
    const result = audit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, 'phải FAIL');
    assert.match(output, /tiếng Việt không dấu.*can tro giup/s, output);
    assert.match(output, /test[/\\]probe\.test\.js/, output);
  }

  // The fix must be accepted: accented text in the same places changes nothing.
  {
    const cwd = await copy('clean');
    await fs.appendFile(path.join(cwd, 'scripts', 'build-web.mjs'), '\nconsole.error("Không tìm thấy đơn hàng này");\n', 'utf8');
    await fs.appendFile(path.join(cwd, 'test', 'probe.test.js'), "\ntest('cần trợ giúp khi không tải được file', () => {});\n", 'utf8');
    const result = audit(cwd);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, `bản có dấu phải sạch:\n${output}`);
  }

  // Two words are not enough to be sure. A bare pair is ambiguous in shape often
  // enough to be useless, and a check that fired on loose words would report every
  // English identifier in the repository and be switched off within a week.
  {
    const cwd = await copy('english');
    await fs.appendFile(path.join(cwd, 'scripts', 'build-web.mjs'), '\nconst paymentWindow = 1; // do not reorder\n', 'utf8');
    const result = audit(cwd);
    assert.equal(result.status, 0, `tiếng Anh không được báo sai:\n${result.stdout}${result.stderr}`);
  }

  // The scope of the widened scans, asserted against the script itself.
  //
  // These were written as end-to-end cases first: copy the project, drop a violation
  // into one file, run the audit, read the output. Each of those copies a large part
  // of the tree, and at thirty of them the file's runtime went from seconds to
  // minutes — while the thing being tested, the audit, still ran in under two seconds.
  // A test harness that gets slower as the project grows is the wrong place to spend
  // the project's budget.
  //
  // So the coverage splits in two. The checks are exercised for real on the project
  // itself, which `npm run audit` runs on every commit and which fails loudly if any
  // of them is wrong about this tree. What is asserted here is the thing a real run
  // cannot show: that these directories are in scope at all. Every one of them was
  // silently unreadable for the life of the old scan, and nothing about running the
  // audit on a clean tree would ever have noticed.
{
      const audit = await fs.readFile(path.join(projectRoot, 'scripts', 'audit-web.mjs'), 'utf8');
    const scopes = audit.slice(
      audit.indexOf('const INFRA_EXTENSIONS'),
      audit.indexOf('// ---------------------------------------------------------------------------\n// 5.'),
    );
    for (const directory of ['deploy', 'scripts', 'cloudflare', 'supabase', '.github']) {
      assert.ok(scopes.includes(`"${directory}"`),
        `thư mục ${directory} không nằm trong phạm vi quét domain — mọi lỗi gõ tay trong đó sẽ không ai thấy`);
    }
    // Recursion through the shared walker, not a bare readdir. isExcludedDir is the
    // single answer to "which directories are skipped"; a second rule here would be
    // the same drift this repository keeps removing elsewhere.
    assert.match(scopes, /walkProjectFiles\(full\)/,
      'phải đi qua walkProjectFiles để dùng chung quy tắc loại trừ thư mục');
    assert.ok(!/await readdir\(full\)/.test(scopes),
      'readdir không đệ quy — chính là lý do scripts/lib/ chưa bao giờ được đọc');
    // The domain pattern, which is what made `https://host` pass while a bare
    // `host` was flagged.
    const pattern = audit.match(/const hostPattern = \(host\) => new RegExp\(([^)]*)\)/);
    assert.ok(pattern, 'phải có một pattern dùng chung cho cả ba vòng quét domain');
    assert.ok(!pattern[1].includes('/'),
      'lookbehind không được loại dấu gạch chéo — "https://host" sẽ lọt trong mọi thư mục ngoài public/');

    // The operator-facing scan, same reasoning: scripts/lib/ and test/helpers/ are
    // where shared code lives, and a misspell there reaches every tool that imports it.
    const operatorScan = audit.slice(audit.indexOf('const operatorFacing = []'));
    for (const directory of ['scripts', 'test', 'deploy']) {
      assert.ok(operatorScan.includes(`"${directory}"`),
        `thư mục ${directory} không nằm trong phạm vi rà tiếng Việt không dấu`);
    }
    assert.match(operatorScan, /walkProjectFiles\(full\)/, 'phải quét đệ quy');
  }

  // The label self-check, on the script that runs it. Kept as a real run because this
  // one needs the copy's own file: a label is dead relative to the code looking for it.
{
      const source = await fs.readFile(path.join(projectRoot, 'scripts', 'audit-web.mjs'), 'utf8');
    const declared = source.slice(source.indexOf('const DECLARED = ['), source.indexOf('];', source.indexOf('const DECLARED = [')));
    const labels = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const callSites = new Set([...source.matchAll(/fail\(\s*"([^"]+)"/g)].map((m) => m[1]));
    const dead = labels.filter((label) => !callSites.has(label));
    assert.deepEqual(dead, [],
      `nhãn kiểm tra không còn call site nào: ${dead.join(', ')} — nó vẫn được tính vào "29 nhom kiem tra" mà không kiểm tra gì`);
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
  for (const required of ['metrics:update', 'render:sync:apply', 'render:sync:deploy', 'render:deploy', 'db:migrate:apply', 'paypal:detect', 'r2:cors:write', 'r2:cors:command']) {
    assert.ok(scripts[required], `package.json thiếu script "${required}"`);
    assert.ok(/(^|\s)--[a-z-]+/.test(scripts[required]), `"${required}" phải tự mang cờ`);
  }
});
