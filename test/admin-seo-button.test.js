import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The SEO editor's whole value is that the owner can tell, without saving, what
// the search result will look like. A save button that is lit before anything
// changed invites a pointless write; one that stays lit after saving leaves the
// owner unsure whether the value took. Both halves are asserted here against the
// real admin.js, not a copy of its logic.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'public', 'admin.js'), 'utf8');

// Only the two functions under test are extracted and run. Running all of
// admin.js needs a logged-in panel, a token and a network, none of which say
// anything about whether the button reacts to a keystroke.
const pick = (name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `khong tim thay ham ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`khong dong duoc ham ${name}`);
};

const sandbox = {};
vm.createContext(sandbox);
new vm.Script(`${pick('seoDirty')}\n${pick('countSeo')}`).runInContext(sandbox);

const makeForm = ({ title = '', description = '' } = {}) => {
  const button = { disabled: false };
  const counter = { className: '', textContent: '' };
  const form = {
    dataset: { seoTitle: title, seoDescription: description },
    elements: { seoTitle: { value: title }, seoDescription: { value: description } },
    querySelector: (selector) => (selector === 'button[type=submit]' ? button : counter),
  };
  return { form, button, counter };
};

test('nut luu xam khi mo form ma chua sua gi', () => {
  const { form, button } = makeForm({ title: 'Tieu de cu', description: 'Mo ta cu' });
  sandbox.countSeo(form);
  assert.equal(button.disabled, true, 'mo form ra chua sua gi thi khong duoc bat nut luu');
});

test('nut sang len khi sua tieu de', () => {
  const { form, button } = makeForm({ title: 'Tieu de cu', description: 'Mo ta cu' });
  sandbox.countSeo(form);
  form.elements.seoTitle.value = 'Tieu de moi';
  sandbox.countSeo(form);
  assert.equal(button.disabled, false, 'sua roi thi nut phai sang de bam duoc');
});

test('nut sang len khi sua ca hai o', () => {
  const { form, button } = makeForm();
  sandbox.countSeo(form);
  assert.equal(button.disabled, true, 'san pham chua co SEO thi nut xam');
  form.elements.seoDescription.value = 'Mo ta moi';
  sandbox.countSeo(form);
  assert.equal(button.disabled, false);
});

test('sua xong bo lai chu thi nut xam tro lai', () => {
  const { form, button } = makeForm({ title: 'Tieu de cu' });
  sandbox.countSeo(form);
  form.elements.seoTitle.value = 'Tieu de khac';
  sandbox.countSeo(form);
  assert.equal(button.disabled, false);
  // Typing back to what it was is not a change, and the button says so.
  form.elements.seoTitle.value = 'Tieu de cu';
  sandbox.countSeo(form);
  assert.equal(button.disabled, true, 've lai gia tri cu thi nut phai xam');
});

test('khoang trang thua duoc bo qua khi so sanh', () => {
  const { form, button } = makeForm({ title: 'Tieu de cu' });
  sandbox.countSeo(form);
  form.elements.seoTitle.value = '  Tieu de cu  ';
  sandbox.countSeo(form);
  assert.equal(button.disabled, true, 'khoang trang quanh van la gia tri cu');
});

test('bo dem canh bao khi chu bi cat o nguong search result', () => {
  const { form, counter } = makeForm({ title: 'A'.repeat(65), description: 'B'.repeat(170) });
  sandbox.countSeo(form);
  assert.match(counter.textContent, /Tiêu đề 65\/70/);
  assert.match(counter.textContent, /Mô tả 170\/175/);
  assert.match(counter.textContent, /bị cắt/);
  assert.match(counter.className, /over/);
});

test('form sua SEO ghi lai gia tri luc mo, va do la noi so sanh', () => {
  assert.ok(/data-seo-title="\$\{esc\(p\.seoTitle\|\|''\)\}"/.test(source), 'phai luu tieu de tai thoi diem mo');
  assert.ok(/data-seo-description="\$\{esc\(p\.seoDescription\|\|''\)\}"/.test(source), 'phai luu mo ta tai thoi diem mo');
  assert.ok(/form\.dataset\.seoTitle/.test(source), 'phai so sanh voi gia tri da luu');
  // A comparison against something written in the script would be a constant.
  assert.ok(/return\s*\(?\s*form\.elements\.seoTitle/.test(source), 'phai so sanh voi o nhap chu khong phai voi hang so');
});

test('sau khi luu, danh sach san pham duoc ve lai tu du lieu moi', () => {
  // Saving re-renders the product list from the server, so the form comes back
  // in its freshly opened state and the button follows that same rule. Nothing
  // should force the button back on afterwards.
  assert.ok(/showToast\('Đã lưu SEO'\);await loadProducts\(\)/.test(source), 'luu xong phai tai lai danh sach san pham tu server');
  assert.ok(!/catch\(e\)\{showToast\(e\.message,true\)\}finally\{button\.disabled=false\}/.test(source),
    'khong duoc bat cuong nguon nut o khoi finally: loi hay thanh cong deu phai theo quy tac so sanh');
});

test('nut kiem tra chi do bang mau, khong phai chi bien mat', async () => {
  const css = await fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  // The logic disables the button correctly and the owner still sees it lit,
  // which reads as "the fix did not work" and costs an hour of debugging.
  assert.ok(/\.button\[disabled\],\.button:disabled\{[^}]*opacity:\.\d+/.test(css), 'nut khoa phai mo, khong chi dung lai');
});
