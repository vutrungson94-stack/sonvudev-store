import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before src/ is imported: config.js reads
// the environment once at load, so this has to come first.
import './helpers/env.mjs';
import { closeTest } from './helpers/teardown.mjs';

// The footer of an English product page carried the four identity labels in
// Vietnamese ("Pháp nhân/đơn vị", "Địa chỉ", "Điện thoại", "Email hỗ trợ")
// while the tagline and every link above them were English. The renderer
// derived the language from the `copy` object instead of the locale it was
// given, so the contact block was pinned to Vietnamese on every product page.
//
// These tests pin the labels at both levels: the shared footer renderer for
// every supported locale, and the full product page for the exact regression
// a reader sees.

process.env.NODE_ENV = 'test';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-footer-i18n-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.BRAND_NAME = 'SonVuDev';
process.env.BRAND_LEGAL_ENTITY = 'Vũ Trung Sơn';
process.env.BRAND_ADDRESS = 'Đường XH3, Tổ 4, Khu Phố Phú Điền, Phường Chánh Phú Hòa, Thành Phố Hồ Chí Minh, Việt Nam';
process.env.BRAND_PHONE = '+84348808045';

const { footerBar, COPY_EN, COPY_VI, renderProductPage } = await import('../src/pages.js');

test.after(async () => { await closeTest(undefined, tempDir); });

const product = {
  id: 'p1',
  slug: 'spark-footer',
  name: 'Spark Capacity Tester',
  version: '1.0.0',
  platform: 'Windows',
  category: 'Tiện ích',
  price: 99000,
  currency: 'VND',
  status: 'active',
  fileKey: 'products/spark/1.0.0/spark.exe',
  shortDescription: 'Kiểm tra dung lượng thật.',
  description: 'Kiểm tra dung lượng thật, không format ổ.',
};

const LABELS = {
  vi: ['Pháp nhân/đơn vị:', 'Địa chỉ:', 'Điện thoại:', 'Email hỗ trợ:'],
  en: ['Legal entity:', 'Address:', 'Phone:', 'Support email:'],
  de: ['Rechtsträger:', 'Adresse:', 'Telefon:', 'Support-E-Mail:'],
  es: ['Entidad legal:', 'Dirección:', 'Teléfono:', 'Email de soporte:'],
  fr: ['Entité légale:', 'Adresse:', 'Téléphone:', 'Email de support:'],
  ja: ['法的主体:', '住所:', '電話:', 'サポートメール:'],
  'zh-CN': ['法律实体:', '地址:', '电话:', '支持邮箱:'],
};
const NAV_CONTACT = {
  vi: 'Liên hệ', en: 'Contact', de: 'Kontakt', es: 'Contacto', fr: 'Contact',
  ja: 'お問い合わせ', 'zh-CN': '联系我们',
};
const hasLabel = (html, label) => html.includes(`<strong>${label}</strong>`);
const footerLinksOf = (html) => {
  const block = /<div class="footer-links">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(block, 'thiếu khối liên kết footer');
  return [...block[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].trim());
};

test('mỗi ngôn ngữ được render với nhãn liên hệ của chính ngôn ngữ đó', () => {
  for (const [lang, labels] of Object.entries(LABELS)) {
    const prefix = lang === 'vi' ? '' : `/${lang}`;
    const html = footerBar('', lang === 'vi' ? COPY_VI : COPY_EN, prefix, lang);
    for (const label of labels) {
      assert.ok(hasLabel(html, label), `${lang}: thiếu nhãn ${label}`);
    }
    if (lang !== 'vi') {
      for (const vietnamese of LABELS.vi) {
        assert.ok(!hasLabel(html, vietnamese), `${lang}: còn nhãn tiếng Việt ${vietnamese}`);
      }
    }
  }
});

test('liên kết Contact và email có tên thật trong mọi ngôn ngữ', () => {
  for (const [lang, contact] of Object.entries(NAV_CONTACT)) {
    // Dùng renderer thật: nó mới là nơi ghép getCopy(lang) với footerBar().
    const html = renderProductPage(product, lang, [], []);
    const links = footerLinksOf(html);
    assert.ok(links.includes(contact), `${lang}: nhãn Contact sai — ${links.join(' | ')}`);
    assert.ok(!links.includes('[object Object]'), `${lang}: còn [object Object]`);
    const mail = LABELS[lang][3].replace(/:$/, '');
    assert.ok(links.includes(mail), `${lang}: liên kết email không có tên — ${links.join(' | ')}`);
    assert.ok(links.every(Boolean), `${lang}: có liên kết rỗng`);
  }
});

test('locale không đăng ký rơi về nhãn tiếng Anh, không rơi về tiếng Việt', () => {
  const html = footerBar('', COPY_EN, '', 'xx');
  for (const label of LABELS.en) assert.ok(hasLabel(html, label), `thiếu nhãn ${label}`);
  for (const vietnamese of LABELS.vi) assert.ok(!hasLabel(html, vietnamese), `còn nhãn ${vietnamese}`);
});

test('trang sản phẩm tiếng Anh dùng nhãn tiếng Anh trong footer', () => {
  const en = renderProductPage(product, 'en', [], []);
  for (const label of LABELS.en) assert.ok(hasLabel(en, label), `footer tiếng Anh thiếu ${label}`);
  for (const vietnamese of LABELS.vi) {
    assert.ok(!hasLabel(en, vietnamese), `footer tiếng Anh còn nhãn ${vietnamese}`);
  }

  const vi = renderProductPage(product, 'vi', [], []);
  for (const label of LABELS.vi) assert.ok(hasLabel(vi, label), `footer tiếng Việt thiếu ${label}`);
});
