import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, runScript, El } from './helpers/dom.mjs';

// Recovery guidance is a promise the store makes at checkout and has to keep on
// the order page. These tests hold both ends to it, because a reassurance that
// only appears once and then vanishes is worse than none.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, 'public', p), 'utf8');

test('biểu mẫu thanh toán nói trước khi khách trả tiền', async () => {
  const source = read('app.js');
  assert.ok(source.includes("T('cart.safety')"), 'form phải có dòng bảo đảm về mất mạng');
  // It has to sit on the form, not after it: once the money has moved the buyer
  // has already left the page and the line is worth nothing.
  const form = source.slice(source.indexOf('function openCheckout('), source.indexOf('async function submitCheckout('));
  assert.ok(form.includes('safety-note'), 'dòng này phải nằm trong biểu mẫu');
  assert.ok(form.indexOf('safety-note') < form.indexOf('cart.continue'), 'phải nằm trước nút thanh toán');
});

test('khối mã tra cứu nói rõ phải lưu lại', async () => {
  const source = read('app.js');
  assert.ok(source.includes("T('order.keepCode')"), 'phải giải thích vì sao cần giữ mã');
  assert.ok(source.includes('/lookup?order='), 'phải có link tra cứu mang sẵn mã đơn');
  // The id belongs in the link, not just in prose: a buyer who has to read it
  // off a screen and retype it is a buyer who never recovers.
  const box = source.slice(source.indexOf('<div class="token-box">'), source.indexOf('${tabs}${box}'));
  assert.ok(box.includes('encodeURIComponent(order.id)'), 'link phải mang mã đơn của chính đơn đó');
});

test('mọi khoá mới đều có cả tiếng Việt lẫn tiếng Anh', async () => {
  const source = read('i18n.js');
  const vi = source.slice(source.indexOf('vi: {'), source.indexOf('en: {'));
  const en = source.slice(source.indexOf('en: {'));
  for (const key of ['cart.safety', 'order.keepCode', 'order.openLookup']) {
    assert.ok(vi.includes(`'${key}'`), `thiếu tiếng Việt: ${key}`);
    assert.ok(en.includes(`'${key}'`), `thiếu tiếng Anh: ${key}`);
  }
});

const lookupDom = (search) => {
  const { document, nodes } = createDom(['lookup-form', 'lookup-status', 'lookup-submit']);
  // A real <form> exposes named controls through `elements`; the stub already
  // has a read-only getter for something else, so shadow it with a plain object.
  const form = new El('form', 'lookup-form');
  Object.defineProperty(form, 'elements', { value: { orderId: { value: '' }, email: { value: '' } }, writable: true });
  document.getElementById = (id) => (id === 'lookup-form' ? form : nodes.get(id));
  return { document, nodes, form, search };
};

const runLookup = async (search) => {
  const { document, form, search: q } = lookupDom(search);
  const run = await runScript(`${read('order-client.js')}\n${read('lookup.js')}`, { document, window: {}, fetch: async () => { throw new Error('not stubbed'); }, location: { search: q, href: '' } });
  return { run, form };
};

test('trang tra cứu nhận sẵn mã đơn từ đường dẫn', async () => {
  const { run, form } = await runLookup('?order=svd-abc-123');
  assert.deepEqual(run.errors, [], 'lookup.js không được ném lỗi');
  // Typed by hand on a phone keyboard is the step where people give up.
  assert.equal(form.elements.orderId.value, 'SVD-ABC-123', 'phải điền sẵn và chuẩn hoá chữ hoa');
});

test('không có tham số thì trang tra cứu vẫn dùng được', async () => {
  const { run, form } = await runLookup('');
  assert.deepEqual(run.errors, []);
  assert.equal(form.elements.orderId.value, '', 'không được tự điền gì');
});
