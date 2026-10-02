import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

// --deploy asked for a restart and did not give one.
//
// The branch that reports "the environment already matches" only triggered a deploy
// when --apply was also passed. So `npm run render:deploy` — which exists precisely
// to push new code — did nothing for every code-only change, printed "Khong co thay
// doi", and exited 0. Every signal said the command had run.
//
// The failure mode is worse than an error. An error stops the deploy from being
// claimed; a silent success means somebody believes the change is live when it is
// not, and finds out from a customer.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'scripts', 'sync-render.mjs'), 'utf8');

test('lệnh --deploy phải deploy kể cả khi môi trường đã khớp', () => {
  // Read the branch where the two are the same, because that is the one that runs on
  // a code-only change. The condition has to be the flag that means "restart", not
  // the flag that means "write the environment".
  const branch = source.slice(source.indexOf('Khong co thay doi'), source.indexOf('for (const change of changes)'));
  assert.ok(branch.length > 0, 'phải còn nhánh "không có thay đổi"');
  assert.match(branch, /if \(redeploy\)/, 'nhánh này phải deploy khi có --deploy');
  assert.ok(
    !/if \(apply && redeploy\)/.test(branch),
    'không được gắn thêm điều kiện apply — đó chính là chỗ làm --deploy im lặng không làm gì',
  );
  assert.match(branch, /services\/\$\{serviceId\}\/deploys/, 'phải gọi API tạo deploy');
});

test('kiểm tra chỉ đọc vẫn chỉ đọc', () => {
  // The other direction matters too: `npm run render:sync` is the dry run people run
  // before changing anything. It must keep writing nothing and deploying nothing —
  // which follows from the flag being required, so that is what is checked.
  assert.match(source, /const redeploy = args\.includes\("--deploy"\)/, 'phải là --deploy mới cho deploy');
  assert.match(source, /const apply = args\.includes\("--apply"\)/, 'phải là --apply mới cho ghi');
  // Every place that talks to Render for a deploy sits behind the flag.
  const calls = [...source.matchAll(/services\/\$\{serviceId\}\/deploys/g)];
  assert.ok(calls.length >= 1, 'phải có ít nhất một chỗ gọi tạo deploy');
  for (const call of calls) {
    const before = source.slice(Math.max(0, call.index - 500), call.index);
    // Two shapes, one property: either the call sits inside `if (redeploy)`, or it
    // follows `if (!redeploy) { … return; }`. The second is the one that was missed —
    // it looks guarded, reads as guarded, and is what a reviewer skims past.
    assert.match(before, /if \(!?redeploy\)/, 'mỗi lần gọi tạo deploy đều phải nằm sau kiểm tra cờ --deploy');
  }
});