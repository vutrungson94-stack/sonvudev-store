import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Shared shop environment first: src/pages.js reads configuration at import.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const LEGAL_PAGES = ['terms.html', 'privacy.html', 'refund.html'];

// The refund policy's date is the one fact on these pages that has to be true in
// two places at once: the page a buyer reads, and the value recorded on the order
// they accepted. If the two disagree, the page says the terms were revised on a
// day they were not, and a disputed order is decided by which one the shop can
// show.
//
// It was tokenised and then typed by hand anyway. REFUND_POLICY_UPDATED existed
// in src/pages.js, the dictionary read it, and three templates still carried the
// literal date in their no-JS fallback — which is the text a crawler reads and the
// text a buyer sees before the dictionary loads. Moving the constant moved the
// English sentence and left the Vietnamese bytes behind.

test('ngày chính sách chỉ có một nguồn, không ai gõ tay trong HTML', () => {
  for (const file of LEGAL_PAGES) {
    const html = read(path.join('public', file));
    assert.ok(
      /\{\{policyUpdatedDisplay\}\}/.test(html),
      `${file}: dòng "Cập nhật" phải lấy ngày từ {{policyUpdatedDisplay}}, không gõ tay — `
      + 'nếu không, đổi hằng số sẽ để lại trang pháp lý in ngày cũ',
    );
    // A literal date in either shape. Both have been written here before.
    assert.ok(
      !/\b\d{2}\/\d{2}\/\d{4}\b/.test(html) && !/\b\d{4}-\d{2}-\d{2}\b/.test(html),
      `${file}: còn ngày gõ tay trong HTML — ngày phải đến từ REFUND_POLICY_UPDATED`,
    );
  }
});

test('từ điển lấy ngày theo đúng ngôn ngữ, không lấy ISO rồi bỏ vào câu tiếng Việt', () => {
  const i18n = read(path.join('public', 'i18n.js'));
  const vi = /'legal\.updated':\s*'([^']*)'/.exec(i18n.slice(i18n.indexOf("legal.updated") - 40))?.[1] || '';
  const enBlock = i18n.slice(i18n.lastIndexOf("'legal.updated'"));
  const en = /'legal\.updated':\s*'([^']*)'/.exec(enBlock)?.[1] || '';
  assert.ok(vi.includes('{{policyUpdatedDisplay}}'), 'câu tiếng Việt phải dùng {{policyUpdatedDisplay}}');
  assert.ok(en.includes('{{policyUpdatedDisplayEn}}'), 'câu tiếng Anh phải dùng {{policyUpdatedDisplayEn}}');
  assert.ok(!vi.includes('{{policyUpdated}}'), 'câu tiếng Việt không được dùng bản ISO — "2026-09-28" không phải cách người Việt viết ngày');
});

test('một hằng số, hai cách viết, cùng một ngày', async () => {
  // The stored value stays ISO because an order record has to compare and sort as
  // a date; the page writes it as a reader reads it. Both come from the constant.
  const { REFUND_POLICY_UPDATED, policyUpdatedFor, PAGE_TOKENS, pageTokenValues } = await import('../src/pages.js');
  assert.match(REFUND_POLICY_UPDATED, /^\d{4}-\d{2}-\d{2}$/, 'hằng số phải là ngày ISO để lưu cùng đơn hàng');
  assert.ok(PAGE_TOKENS.includes('policyUpdatedDisplay'), 'PAGE_TOKENS phải khai báo policyUpdatedDisplay');

  const values = pageTokenValues();
  assert.equal(values.policyUpdated, REFUND_POLICY_UPDATED, 'bản ghi vào đơn phải là hằng số');
  assert.equal(values.policyUpdatedDisplay, '28/09/2026', 'bản in ra trang phải là ngày đọc được');
  assert.equal(
    policyUpdatedFor(REFUND_POLICY_UPDATED, 'en').replace(/\s+/g, ' '),
    policyUpdatedFor(REFUND_POLICY_UPDATED, 'en'),
    'bản tiếng Anh phải ổn định giữa hai lần gọi',
  );
  // An unparseable value is passed through rather than becoming "Invalid Date".
  assert.equal(policyUpdatedFor('không-phải-ngày', 'vi'), 'không-phải-ngày');
});