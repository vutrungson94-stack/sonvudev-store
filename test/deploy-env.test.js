import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first and has to be
// complete. See helpers/env.mjs for what a missing entry used to cost.
import './helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');

// The failure this file exists to prevent.
//
// A deploy descriptor lists the variables it knows about. The application reads
// fifty. Nothing connects the two lists, so a variable can be absent from the
// descriptor for as long as nobody notices — and "nobody notices" is the whole
// problem, because the two classes of missing variable behave completely
// differently:
//
//   Loud ones. Missing SUPABASE_URL and the persistence mode is reported in the
//   boot log, in /api/health, and in every audit run. Costs an afternoon.
//
//   Quiet ones. Missing BANK_ACCOUNT_NUMBER and nothing anywhere says so. The
//   boot log is green. /api/health says ok. Every check passes. The checkout
//   simply stops offering bank transfer, because src/config.js decides a bank
//   method exists only when three values are real and src/payments.js answers
//   null for the one that is not. The shop keeps taking money through PayPal,
//   never reports a fault, and the reason a third of Vietnamese buyers abandoned
//   at the payment step is a missing line in a YAML file.
//
// render.yaml shipped without the bank variables. Nothing in the repository would
// have caught it, because nothing read both files.

const renderKeys = async () => new Set(
  [...(await read('render.yaml')).matchAll(/^\s+- key:\s*(\S+)/gm)].map((m) => m[1]),
);

const configKeys = async () => new Set(
  [...(await read('src/config.js')).matchAll(/(?:value|numberValue)\("([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]),
);

// Variables the shop can run perfectly well without. Each one is a deliberate
// omission, not an oversight, and each says what happens when it is absent —
// because the whole cost of this file is being able to tell the difference.
const OPTIONAL = new Map(Object.entries({
  DATA_DIR: 'Supabase bật thì bỏ qua. Render có filesystem read-only nên để trống là đúng.',
  PORT: 'Render tự cấp. Không được ghi — ghi cứng sẽ phá liên kết của nền tảng.',
  PAYPAL_VND_TO_USD_RATE: 'có tỷ giá cứng dự phòng; đặt khi không muốn dùng.',
  PAYPAL_VND_TO_USD_FALLBACK: 'xem trên.',
  PAYPAL_RATE_TTL_SECONDS: 'có mặc định và đã cache trong DB.',
  PAYPAL_RATE_MARGIN_PERCENT: 'có mặc định.',
  R2_DOWNLOAD_URL_TTL_SECONDS: 'có mặc định.',
  R2_UPLOAD_URL_TTL_SECONDS: 'có mặc định.',
  ORDER_EXPIRY_WARN_HOURS: 'có mặc định.',
  ORDER_PAYMENT_WINDOW_HOURS: 'có mặc định (24).',
  ORDER_SWEEP_INTERVAL_MS: 'có mặc định.',
  ORDER_SWEEP_DISABLED: 'chỉ dùng khi muốn tắt sweeper.',
  GEO_CACHE_HOURS: 'có mặc định.',
  GEO_LOOKUP: 'tắt GeoIP thì để trống; rate limit vẫn chạy theo IP.',
  BRAND_FOUNDER_NAME: 'optional trên trang giới thiệu.',
  BRAND_FOUNDER_URL: 'optional trên trang giới thiệu.',
  BRAND_SOCIAL_LINKS: 'optional.',
  BRAND_LEGAL_ENTITY: 'optional; hiện ở cuối trang điều khoản.',
  EMAIL_FROM: 'lấy từ SUPPORT_EMAIL nếu trống.',
  BANK_BIN: 'có mặc định 970436.',
  BANK_TRANSFER_NOTE_PREFIX: 'optional.',
  INDEXNOW_KEY: 'tắt IndexNow nếu trống.',
  GOOGLE_SITE_VERIFICATION: 'chỉ cho Search Console.',
  BING_SITE_VERIFICATION: 'chỉ cho Bing Webmaster.',
}));

// Variables whose absence removes a payment method without any error. These are
// the ones that must be in the descriptor.
const PAYMENT_METHOD_GATES = [
  { keys: ['BANK_NAME', 'BANK_ACCOUNT_NAME', 'BANK_ACCOUNT_NUMBER'], method: 'chuyển khoản ngân hàng' },
  { keys: ['MOMO_ACCOUNT_NUMBER'], method: 'MoMo' },
  { keys: ['ZALOPAY_ACCOUNT_NUMBER'], method: 'ZaloPay' },
];

test('render.yaml khai mọi biến mà đổi hành vi thanh toán', async () => {
  const declared = await renderKeys();
  for (const { keys, method } of PAYMENT_METHOD_GATES) {
    for (const key of keys) {
      assert.ok(declared.has(key),
        `render.yaml thiếu ${key}. Thiếu nó thì phương thức "${method}" biến mất khỏi trang thanh toán, `
        + 'không có log, không có lỗi, /api/health vẫn báo ok — checkout chỉ đơn giản là thiếu một cách trả tiền.');
    }
  }
});

test('mọi biến trong render.yaml đều được src/config.js thực sự đọc', async () => {
  // The other direction. A key in the descriptor that nothing reads is a typo or
  // a leftover, and it is the reason a variable can look configured in the
  // dashboard while the application is running on its default.
  const declared = await renderKeys();
  const readByConfig = await configKeys();
  // Handled by the platform or by npm, not by config.js.
  const notConfigVars = new Set(['NODE_VERSION', 'NODE_ENV']);
  for (const key of declared) {
    if (notConfigVars.has(key)) continue;
    assert.ok(readByConfig.has(key),
      `render.yaml khai ${key} nhưng src/config.js không đọc biến này — gõ sai tên, hoặc biến đã bị bỏ mà quên dọn.`);
  }
});

test('mọi biến config.js đọc đều có mặt trong render.yaml hoặc được ghi rõ là tuỳ chọn', async () => {
  const declared = await renderKeys();
  const readByConfig = await configKeys();
  const notConfigVars = new Set(['NODE_VERSION', 'NODE_ENV']);
  const unaccounted = [...readByConfig]
    .filter((key) => !declared.has(key) && !OPTIONAL.has(key) && !notConfigVars.has(key))
    .sort();
  assert.deepEqual(unaccounted, [],
    `src/config.js đọc những biến không có trong render.yaml và cũng không được khai là tuỳ chọn: `
    + `${unaccounted.join(', ')}. Thêm vào render.yaml, hoặc vào OPTIONAL kèm lý do.`);
});

test('danh sách OPTIONAL không chứa biến có thật trong render.yaml', async () => {
  // Otherwise OPTIONAL becomes a place to park things that are actually
  // configured, and the check above stops meaning anything.
  const declared = await renderKeys();
  for (const key of OPTIONAL.keys()) {
    assert.ok(!declared.has(key),
      `${key} vừa nằm trong OPTIONAL vừa có trong render.yaml — một trong hai sai, và check trên sẽ không bắt được nữa.`);
  }
});

test('không biến nào trong render.yaml chứa secret', async () => {
  const yaml = await read('render.yaml');
  // Every secret must be `sync: false` so Render prompts for it in the dashboard.
  // A literal here is in git history from the moment it is pushed.
  for (const line of yaml.split('\n')) {
    const value = /\s+value:\s*(.+?)\s*$/.exec(line);
    if (!value) continue;
    assert.ok(value[1].length <= 24,
      `render.yaml gõ giá trị dài (${value[1].length} ký tự): ${line.trim()} — hình dạng của một secret bị commit`);
    assert.doesNotMatch(line, /secret|token|password|api[_-]?key|private/i,
      `render.yaml có vẻ ghi secret: ${line.trim()}`);
  }
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_CLIENT_SECRET', 'RESEND_API_KEY',
    'ADMIN_API_TOKEN', 'R2_SECRET_ACCESS_KEY', 'BANK_ACCOUNT_NUMBER', 'MOMO_ACCOUNT_NUMBER',
    'ZALOPAY_ACCOUNT_NUMBER', 'PAYPAL_ACCOUNT_EMAIL']) {
    assert.match(yaml, new RegExp(`key:\\s*${key}\\s*\\n\\s*(sync:\\s*false|generateValue:\\s*true)`),
      `${key} phải là sync: false hoặc generateValue — không được gõ giá trị vào repo`);
  }
});

test('APP_URL trỏ về chính nó, để canonical và sitemap không trỏ nhầm', async () => {
  const yaml = await read('render.yaml');
  // APP_URL is what src/config.js puts in every canonical link, every hreflang,
  // the sitemap, the robots.txt and the PayPal return URL. On Render the service
  // also has an onrender.com address, and a mismatch means the site tells Google
  // it lives at one URL while serving another. It has to be set by hand because it
  // is a domain, and it must be sync: false rather than a literal.
  assert.match(yaml, /key:\s*APP_URL\s*\n\s*sync:\s*false/,
    'APP_URL phải là sync: false — nó là tên miền riêng, không phải giá trị gõ sẵn');
  assert.doesNotMatch(yaml, /key:\s*APP_URL\s*\n\s*value:/,
    'APP_URL không được gõ giá trị trong render.yaml — sẽ lệch với tên miền thật');
});