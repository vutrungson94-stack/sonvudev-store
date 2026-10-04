import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';
import { AI_CRAWLERS, ROBOTS_DISALLOW, renderRobotsTxt } from '../src/robots.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');

// robots.txt is the one file where the response and the check that verifies it were
// written separately, and they had already drifted: the server disallowed
// /paypal-return and scripts/seo-check.mjs listed four rules, not five. Nothing
// turned red. The rule simply stopped being verified, which is the quietest way a
// privacy control loses its test — and it is a control, because /order/ and
// /lookup/ carry a buyer's access token in the URL, so indexing one publishes a
// working link to their receipt.
//
// These tests exist so the third copy cannot appear. The body is built once, in
// src/robots.js; everything below asserts that every consumer reads that module
// rather than writing its own list.
test('robots.txt chứa mọi lệnh Disallow và mọi crawler AI trong danh sách', () => {
  const body = renderRobotsTxt('https://shop.example');

  for (const rule of ROBOTS_DISALLOW) {
    assert.ok(body.includes(`Disallow: ${rule}`),
      `robots.txt thiếu "Disallow: ${rule}" — đường dẫn riêng sẽ bị crawler đọc`);
  }
  for (const agent of AI_CRAWLERS) {
    assert.match(body, new RegExp(`User-agent:\\s*${agent}\\s*\\n\\s*Allow:\\s*/`),
      `robots.txt không cho phép ${agent} bằng tên`);
  }
  assert.match(body, /Sitemap: https:\/\/shop\.example\/sitemap\.xml/);
});

// The catalogue is the product, and answer engines are where people look for it
// now. A blank that is easy to drop in is not a decision that was made.
test('thêm bot mới phải được khai báo, xoá bot phải là một quyết định có chủ ý', () => {
  for (const agent of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended']) {
    assert.ok(AI_CRAWLERS.includes(agent), `${agent} phải nằm trong AI_CRAWLERS`);
  }
});

// An empty list would render a robots.txt that disallows nothing, and both the audit
// and the checker would agree with it. That is the failure mode a shared constant
// creates when the module it lives in stops being readable.
test('danh sách không được rỗng — rỗng nghĩa là mọi thứ đều bị cho phép', () => {
  assert.ok(ROBOTS_DISALLOW.length >= 5,
    `ROBOTS_DISALLOW rỗng hoặc ngắn hơn 5 mục: ${ROBOTS_DISALLOW.length}`);
  assert.ok(AI_CRAWLERS.length >= 7, `AI_CRAWLERS rỗng hoặc ngắn hơn 7 mục: ${AI_CRAWLERS.length}`);
});

test('server gửi robots.txt từ src/robots.js, không viết lại danh sách', async () => {
  const app = await read('src/app.js');
  assert.match(app, /import \{ renderRobotsTxt \} from "\.\/robots\.js"/,
    'src/app.js phải import renderRobotsTxt từ src/robots.js');
  assert.ok(!/Disallow:\s*\\?["']\/admin/.test(app),
    'src/app.js không được chứa lại danh sách Disallow — đó là bản sao thứ hai');
});

test('seo-check và audit đọc cùng một danh sách, không tự chép', async () => {
  const seo = await read('scripts/seo-check.mjs');
  const audit = await read('scripts/audit-web.mjs');

  assert.match(seo, /from "\.\.\/src\/robots\.js"/,
    'scripts/seo-check.mjs phải import từ src/robots.js');
  assert.ok(!/for \(const rule of \[/.test(seo),
    'scripts/seo-check.mjs không được giữ danh sách rule riêng');
  assert.ok(seo.includes('AI_CRAWLERS'),
    'scripts/seo-check.mjs phải kiểm tra cả các crawler AI được cho phép');

  // The audit scrapes the module's text rather than importing it, because it runs
  // against a copy of the tree in test fixtures. The scrape is therefore a silent
  // failure: a renamed export leaves it reading nothing, and "structured data points
  // at a hidden page" becomes a check that always passes. So the audit has to fail
  // loudly when it cannot read the list.
  assert.match(audit, /ROBOTS_DISALLOW/,
    'scripts/audit-web.mjs phải đọc ROBOTS_DISALLOW từ src/robots.js');
  assert.match(audit, /không đọc được ROBOTS_DISALLOW/,
    'scripts/audit-web.mjs phải báo lỗi khi không đọc được danh sách, thay vì im lặng bỏ qua kiểm tra');
});
