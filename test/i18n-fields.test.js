import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';
import { COPY_EN, COPY_VI } from '../src/pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');

const VI = /[ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/;

// The English side of the shop did not exist, and it did not exist because of one
// missing link rather than a missing feature: the columns were there, the API accepted
// every field, the store round-tripped them — and the admin form had no input for a
// single one of them. So the owner could not fill them, the columns stayed empty, and
// every English page quietly fell back to Vietnamese.
//
// A capability that exists in a database but has no way to be filled in is not a
// half-finished feature, it is a lie: the /en/ pages were indexed, declared as the
// English alternative in hreflang, and served Vietnamese. These tests hold the three
// ends together — a field the form can send, a field the API stores, and a field the
// page reads in the other language — because any one of them alone would pass.
test('form admin có ô nhập tiếng Anh cho cả ba trường còn thiếu', async () => {
  const html = await read(path.join('public', 'admin.html'));
  for (const field of ['shortDescriptionEn', 'descriptionEn', 'featuresEn']) {
    assert.match(html, new RegExp(`name="${field}"`),
      `public/admin.html thiếu ô nhập ${field} — API và schema đã có, chỉ thiếu ô này là trang /en/ không bao giờ có tiếng Anh`);
  }
});

// Sending the field is not the same as sending it usefully. features is a textarea of
// one-per-line and the server wants an array; featuresEn was a string while the server
// expected an array, so it was dropped and the English feature list was empty even
// after the owner typed one.
test('featuresEn được tách thành mảng như features, không gửi chuỗi', async () => {
  const js = await read(path.join('public', 'admin.js'));
  assert.match(js, /featuresEn:lines\(data\.featuresEn\)/,
    'admin.js phải tách featuresEn thành mảng — server nhận mảng, gửi chuỗi thì bị bỏ im lặng');
  assert.match(js, /const lines=v=>String\(v\|\|''\)/,
    'phải có helper lines() dùng chung cho cả hai ngôn ngữ');
  assert.match(js, /features:lines\(data\.features\)/,
    'features cũng phải dùng helper đó');
  // And it must be robust when the field is absent, which is every product created
  // before this field existed.
  assert.ok(!/data\.featuresEn\.split/.test(js),
    'không được .split trực tiếp trên data.featuresEn — thiếu ô là ném exception');
});

test('API nhận và lưu đủ sáu trường song ngữ cùng SEO', async () => {
  const app = await read(path.join('src', 'app.js'));
  const post = app.match(/app\.post\("\/api\/admin\/products"[\s\S]{0,2400}/)?.[0] || '';
  for (const field of ['shortDescriptionEn', 'descriptionEn', 'featuresEn', 'seoTitle', 'seoDescription', 'seoTitleEn', 'seoDescriptionEn']) {
    assert.ok(post.includes(field), `API phải đọc và lưu ${field}`);
  }
  // `featured` was dropped from the schema and from db-migrate as a column nothing
  // wrote or read. Leaving it in the API would leave the last reference to a column the
  // project no longer declares.
  assert.ok(!post.includes('featured'),
    'app.js không được gửi featured nữa — cột đó đã bỏ khỏi schema.sql và db-migrate.mjs');
});

test('schema có đủ cột _en cho mô tả và SEO', async () => {
  const sql = await read(path.join('supabase', 'schema.sql'));
  for (const column of ['short_description_en', 'description_en', 'features_en', 'seo_title_en', 'seo_description_en']) {
    assert.match(sql, new RegExp(`add column if not exists\\s+${column}\\b`),
      `supabase/schema.sql thiếu cột ${column}`);
  }
});

// `category` and `badge` are free-text columns: whatever the owner typed, in whichever
// language they were typing. Rendering them raw put "Công cụ" at the top of the English
// page on a URL declared as the English alternative of the Vietnamese one.
test('danh mục và nhãn hiển thị đúng ngôn ngữ, giá trị lạ thì giữ nguyên', async () => {
  const { localised } = await import('../src/pages.js');
  // Known values translate.
  assert.equal(localised('Công cụ', COPY_EN.categories, COPY_EN.software), 'Tools');
  assert.equal(localised('Mới', COPY_EN.badges), 'New');
  // Vietnamese keeps its own wording.
  assert.equal(localised('Công cụ', COPY_VI.categories, COPY_VI.software), 'Công cụ');
  // An empty column falls back rather than printing "undefined".
  assert.equal(localised('', COPY_EN.categories, COPY_EN.software), 'Software');
  assert.equal(localised(null, undefined, 'Software'), 'Software');
  assert.equal(localised(undefined, COPY_EN.categories, COPY_EN.software), 'Software');
  // A category the owner invented still appears, in one language, rather than leaving
  // an empty eyebrow. Dropping it would hide what the product is; the reader can see
  // it is untranslated, which is true and fixable, rather than missing it.
  assert.equal(localised('Danh mục mới', COPY_EN.categories, 'x'), 'Danh mục mới');
});

test('hai bảng dịch có cùng bộ khóa danh mục và nhãn', () => {
  assert.deepEqual(Object.keys(COPY_EN.categories).sort(), Object.keys(COPY_VI.categories).sort(),
    'bảng dịch danh mục lệch nhau — sẽ có giá trị dịch ở một ngôn ngữ và không ở ngôn ngữ kia');
  assert.deepEqual(Object.keys(COPY_EN.badges).sort(), Object.keys(COPY_VI.badges).sort(),
    'bảng dịch nhãn lệch nhau');
});

// The real state of the shop today: two products with only Vietnamese filled in. The
// English page must not pretend otherwise, and must not serve a Vietnamese meta
// description either — that is the one field where falling back is worse than deriving.
test('sản phẩm chỉ có tiếng Việt vẫn render trang /en/ mà không hỏng', async () => {
  const { renderProductPage } = await import('../src/pages.js');
  const product = {
    id: 'x', slug: 'x', name: 'Spark Capacity Tester', version: '1.4.0',
    price: 199000, currency: 'VND', category: 'Công cụ', platform: 'Windows',
    shortDescription: 'Đo dung lượng thật', description: 'Mô tả tiếng Việt', features: ['A'],
    requirements: 'Windows 10/11',
  };
  const html = renderProductPage(product, 'en');
  assert.equal(html.match(/<html lang="([^"]*)"/)?.[1], 'en');
  assert.match(html, /<p class="eyebrow">Tools/, 'danh mục phải dịch sang Tools');
  // SEO copy is deliberately not backfilled from Vietnamese (see pages.js), so the
  // English page must carry a derived title rather than the Vietnamese one.
  assert.ok(!VI.test(html.match(/<meta name="description" content="([^"]*)"/)?.[1] || ''),
    'meta description tiếng Anh không được là tiếng Việt');
});