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
  const classes = new Set();
  const form = {
    dataset: { seoTitle: title, seoDescription: description },
    elements: { seoTitle: { value: title, readOnly: false }, seoDescription: { value: description, readOnly: false } },
    querySelector: (selector) => (selector === 'button[type=submit]' ? button : counter),
    // seoLock marks the form and sets readOnly on both fields, so the stub has to
    // carry all three or the assertion below would pass on a no-op.
    querySelectorAll: () => Object.values(form.elements),
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    classes,
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

test('sau khi luu, nut phai theo dung quy tac so sanh chu khong duoc ai bat', () => {
  // The requirement, not the mechanism: after a save the button's state comes from
  // the same comparison that governs typing, and nothing switches it on regardless.
  //
  // It used to be implemented by re-rendering the whole product list, so the form
  // came back hidden and its own cleanup ran on the form that had just been replaced —
  // which is why pressing Lưu SEO looked like nothing happened. The baseline was also
  // never written back, so even an intact form stayed "dirty" for ever: lit button,
  // counters still saying unsaved, and a second save writing the same two fields.
  const save = source.slice(source.indexOf('async function saveSeo'), source.indexOf('async function uploadExistingProduct'));
  assert.ok(save.length > 0, 'khong tim thay saveSeo');

  // The baseline comes from what the server stored. The API truncates a title to 70
  // characters and a description to 175, so a long paste comes back shorter;
  // comparing against the typed text would leave the form permanently dirty and
  // quietly re-send the over-length value on the next save.
  assert.match(save, /stored\.seoTitle/, 'baseline phai lay tu gia tri server tra ve');
  assert.match(save, /stored\.seoDescription/, 'baseline phai lay tu gia tri server tra ve');
  assert.match(save, /form\.dataset\.seoTitle\s*=/, 'phai ghi baseline');
  assert.match(save, /form\.dataset\.seoDescription\s*=/, 'phai ghi baseline');

  // The button state is computed by the shared rule, on both paths, and never
  // assigned directly after the fact.
  assert.match(save, /countSeo\(form\)/, 'trang thai nut phai do countSeo quyet dinh');
  assert.match(save.slice(save.lastIndexOf('catch')), /countSeo\(form\)/, 'that bai cung phai chay lai quy tac de mo nut thu lai');
  assert.ok(!/catch\(e\)\{[^}]*\}\s*finally\{[^}]*button\.disabled\s*=\s*false/.test(source),
    'khong duoc bat cuong nguon nut o khoi finally: loi hay thanh cong deu phai theo quy tac so sanh');
  assert.ok(!/finally\{[^}]*button\.disabled\s*=\s*false/.test(save),
    'nut SEO khong duoc duoc bat cuong nguon sau khi luu');
});

test('nut kiem tra chi do bang mau, khong phai chi bien mat', async () => {
  const css = await fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8');
  // The logic disables the button correctly and the owner still sees it lit,
  // which reads as "the fix did not work" and costs an hour of debugging.
  assert.ok(/\.button\[disabled\],\.button:disabled\{[^}]*opacity:\.\d+/.test(css), 'nut khoa phai mo, khong chi dung lai');
});

// The source checks above pin the contract. This runs the real saveSeo, so the claim
// "pressing Lưu SEO locks the button" is demonstrated rather than pattern-matched.
test('bam Luu SEO that thi nut khoa lai va form bao "Đã lưu"', async () => {
  const save = source.slice(source.indexOf('async function saveSeo'), source.indexOf('async function uploadExistingProduct'));
  const box = vm.createContext({ encodeURIComponent, console, JSON });
  vm.runInContext(`${pick('seoDirty')}\n${pick('countSeo')}\n${pick('seoLock')}\n${save}`, box);

  const sent = [];
  const toasts = [];
  const toggle = { textContent: 'Thêm SEO', dataset: { seoToggle: 'prod-1' } };
  box.productList = { querySelectorAll: () => [toggle] };
  box.showToast = (message, isError) => toasts.push({ message, isError });
  // Stands in for the server, and echoes back what it stored — including the
  // truncation it really performs, which is what the baseline has to be measured
  // against.
  box.api = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    const stored = { seoTitle: sent.at(-1).body.seoTitle.slice(0, 70), seoDescription: sent.at(-1).body.seoDescription.slice(0, 175) };
    return { product: stored };
  };
  // A real FormData is iterable, and the code calls Object.fromEntries on it
  // directly, so the stub has to be too.
  box.FormData = function (form) {
    const pairs = Object.keys(form.elements).map((key) => [key, form.elements[key].value]);
    return { [Symbol.iterator]: () => pairs[Symbol.iterator]() };
  };

  const build = (title, description) => {
    const { form, button, counter } = makeForm({ title, description });
    // The form knows which product it edits, and that is how it finds its row.
    form.dataset.seoForm = 'prod-1';
    form.elements.seoTitle.value = title;
    form.elements.seoDescription.value = description;
    return { form, button, counter };
  };

  // Open the editor and type. The button lights up.
  const typed = build('Tieu de cu', 'Mo ta cu');
  box.countSeo(typed.form);
  typed.form.elements.seoTitle.value = 'Bam macro Excel khong can chinh tay';
  typed.form.elements.seoDescription.value = 'Tu them thu muc tin cay, co cach hoan tac.';
  box.countSeo(typed.form);
  assert.equal(typed.button.disabled, false, 'da sua thi nut phai sang de bam duoc');

  // Save. This is the step that did nothing visible.
  await box.saveSeo({ preventDefault() {}, currentTarget: typed.form });

  assert.equal(sent.length, 1, 'phai gui mot request');
  assert.equal(sent[0].body.seoTitle, 'Bam macro Excel khong can chinh tay');
  assert.equal(toasts.at(-1).message, 'Đã lưu SEO');
  assert.equal(typed.button.disabled, true, 'luu xong nut phai khoa lai — day la loi dang bao cao');
  assert.match(typed.counter.textContent, /Đã lưu/, 'form phai noi la da luu');
  assert.match(typed.counter.className, /clean/);
  assert.equal(toggle.textContent, 'Sửa SEO', 'nut cua dong phai doi sangSua SEO');

  // The fields go read-only too. That is the part the report asked for: a greyed
  // Save button on its own still looks like an unsaved form, because the boxes
  // still accept typing and nothing says the values are already published.
  assert.equal(typed.form.elements.seoTitle.readOnly, true, 'ô tiêu đề phải khoá lại');
  assert.equal(typed.form.elements.seoDescription.readOnly, true, 'ô mô tả phải khoá lại');
  assert.ok(typed.form.classes.has('locked'), 'form phải có trạng thái đã khoá');

  // And it stays locked rather than drifting back on a keystroke that changed
  // nothing, which is what "no changes yet the button is lit" would look like.
  box.countSeo(typed.form);
  assert.equal(typed.button.disabled, true);

  // Typing again re-arms it, because there is now something to save.
  typed.form.elements.seoTitle.value = 'Khac di';
  box.countSeo(typed.form);
  assert.equal(typed.button.disabled, false);

  // A long paste is the case the old code got permanently wrong: the server shortens
  // it, so the baseline has to be the stored value or the form never comes back
  // clean and every later save re-sends the over-length text.
  const long = build('Cu', 'Ngan');
  box.countSeo(long.form);
  long.form.elements.seoTitle.value = 'A'.repeat(90);
  await box.saveSeo({ preventDefault() {}, currentTarget: long.form });
  assert.equal(long.form.elements.seoTitle.value.length, 70, 'o nhap phai hien dung do dai da luu');
  assert.equal(long.button.disabled, true, 'form phai sach sau khi server cat ngan');
  assert.equal(long.form.dataset.seoTitle.length, 70);
});

test('luu that bai thi nut phai mo lai de thu lai duoc', async () => {
  const save = source.slice(source.indexOf('async function saveSeo'), source.indexOf('async function uploadExistingProduct'));
  const box = vm.createContext({ encodeURIComponent, console, JSON });
  vm.runInContext(`${pick('seoDirty')}\n${pick('countSeo')}\n${pick('seoLock')}\n${save}`, box);

  const { form, button } = makeForm({ title: 'Cu', description: 'Cu' });
  form.dataset.seoForm = 'prod-1';
  form.elements.seoTitle.value = 'Thu lai di';
  box.productList = { querySelectorAll: () => [] };
  box.showToast = () => {};
  box.api = async () => { throw new Error('mang hong'); };
  box.FormData = function (form) {
    const pairs = Object.keys(form.elements).map((key) => [key, form.elements[key].value]);
    return { [Symbol.iterator]: () => pairs[Symbol.iterator]() };
  };

  await box.saveSeo({ preventDefault() {}, currentTarget: form });
  // A save that failed must not leave the owner with a dead button and no way to
  // retry — which is the one outcome worse than the bug being reported.
  assert.equal(button.disabled, false, 'that bai thi nut phai mo cho thu lai');
  assert.notEqual(form.dataset.seoTitle, 'Thu lai di', 'baseline khong duoc doi khi chua luu duoc');
});
