// Checks a deployed shop against every integration it is supposed to have.
//
//   npm run health:check
//   npm run health:check -- https://sonvudev-store.onrender.com
//
// WHY THIS IS A SCRIPT AND NOT A CURL
//
// /api/health already answers with a JSON object naming every integration it found
// and every one it did not. That was built so a monitor could read it, and it is
// the right shape for that. It is the wrong shape for a person who has just spent
// an hour pasting secrets into a dashboard and does not know whether any of them
// took effect.
//
// The failure this is for is silent by construction. A missing bank account
// number does not make the process unhappy: the boot log is green, /api/health
// says ok, every check in the repository passes, and the only consequence is that
// the checkout has quietly stopped offering a way to pay. The variables are
// correct — the host simply never received them, or received one with a typo in
// its name, or received last week's value.
//
// So: every line below says what to look at when it fails, and names the
// variable. No output ever contains a secret — this reads /api/health, which is
// public by design, and never reads the dashboard's values.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every integration the shop can have, how to tell, and what its absence means.
 *
 * `want` is what a shop selling software is supposed to have. Optional
 * integrations are listed with `want: false` and reported as such rather than
 * omitted — a line that says "not set, that is fine" is information; a line that
 * is not there is not.
 */
const EXPECTED = [
  {
    id: 'persistence',
    want: true,
    read: (b) => b.persistence === 'supabase',
    label: 'Supabase giữ đơn hàng',
    fix: 'Đặt SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trên Render. Không có thì host chạy bằng file JSON trong bộ nhớ tạm và MẤT ĐƠN mỗi lần restart.',
  },
  {
    id: 'database',
    want: true,
    read: (b) => b.checks?.database === 'ok',
    label: 'Kết nối database thành công',
    fix: 'SUPABASE_URL sai, hoặc service role key đã bị rotate. Kiểm tra key còn hiệu lực trong Supabase → Project Settings → API.',
  },
  {
    id: 'storage',
    want: true,
    read: (b) => b.checks?.storage === 'ok' || String(b.checks?.storage).startsWith('skipped'),
    label: 'Nơi lưu trữ đã sẵn sàng',
    fix: 'Báo lỗi nghĩa là host này không có ổ ghi được. Nếu Supabase đã bật mà dòng này vẫn lỗi, thì persistence đang là local-json — xem lại dòng trên.',
  },
  {
    id: 'paypalEnvironment',
    want: true,
    read: (b) => b.paypalEnvironment === 'live',
    label: 'PayPal đang ở chế độ LIVE',
    // The one worth reading twice. Every other signal on this endpoint can be
    // green while this is not: sandbox credentials authenticate against the
    // sandbox API without complaint, so the shop looks healthy, accepts the order,
    // and the capture is refused for money that is never real.
    fix: 'Đặt PAYPAL_ENVIRONMENT=live. Còn để trống thì host tự coi là sandbox — đơn tạo được, tiền thật không bao giờ vào.',
  },
  {
    id: 'paypal',
    want: true,
    read: (b) => b.paypal === true,
    label: 'PayPal client ID + secret',
    fix: 'Đặt PAYPAL_CLIENT_ID và PAYPAL_CLIENT_SECRET trên Render. Cả hai phải cùng một ứng dụng trong PayPal Developer.',
  },
  {
    id: 'paypalWebhook',
    want: true,
    read: (b) => b.paypalWebhook === true,
    label: 'PayPal webhook ID',
    fix: 'Đặt PAYPAL_WEBHOOK_ID. Thiếu nó thì PayPal báo payment thành công nhưng đơn không bao giờ chuyển sang paid — khách đã trả tiền mà không nhận được link tải.',
  },
  {
    // The failure mode this one exists for: a variable that is set, is not empty,
    // passes every presence check, and is wrong. Re-creating a webhook in PayPal
    // issues a new id, so the copy in the dashboard silently expires while the
    // variable stays non-empty. Verification then fails for every delivery, the
    // endpoint answers 400, and a paying customer never gets their download.
    //
    // So the id is printed. It is not a secret — it sits next to the webhook URL
    // in the PayPal developer dashboard — and comparing the two is the only way
    // to notice before a customer's money is involved.
    id: 'paypalWebhookId',
    want: true,
    read: (b) => typeof b.paypalWebhookId === 'string' && b.paypalWebhookId.trim().length > 0,
    label: 'Webhook ID hiện tại (đối chiếu với PayPal)',
    fix: 'Sao chép Webhook ID trong PayPal Developer → app → tab Live → Live Webhooks, dán vào PAYPAL_WEBHOOK_ID trên Render. Tạo lại webhook là sinh ID mới, còn biến cũ vẫn non-empty nên mọi kiểm tra "có cấu hình chưa" đều báo đạt.',
  },
  {
    id: 'email',
    want: true,
    read: (b) => b.email === 'resend',
    label: 'Gửi email qua Resend',
    fix: 'Đặt RESEND_API_KEY. Nếu là "outbox" thì email đơn hàng chỉ được ghi ra data/outbox, khách KHÔNG nhận được xác nhận, hết hạn, hay thông báo đã thanh toán.',
  },
  {
    id: 'bank',
    want: true,
    read: (b) => b.bank === true,
    label: 'Chuyển khoản ngân hàng',
    // The silent one. Nothing anywhere reports this as wrong. The checkout simply
    // stops offering transfers, and because PayPal still works the shop keeps
    // taking money and keeps reporting itself healthy.
    fix: 'Đặt cả BANK_NAME, BANK_ACCOUNT_NAME và BANK_ACCOUNT_NUMBER. Thiếu một trong ba thì phương thức này biến mất khỏi checkout, không có log, không có lỗi.',
  },
  {
    id: 'r2',
    want: true,
    read: (b) => b.r2 === true,
    label: 'Kho file R2',
    fix: 'Đặt R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY và R2_BUCKET_NAME. Thiếu thì admin không upload được file phát hành.',
  },
  {
    id: 'admin',
    want: true,
    read: (b) => b.admin === true,
    label: 'Token quản trị',
    fix: 'Đặt ADMIN_API_TOKEN. render.yaml để generateValue nên Render tự sinh — lấy giá trị đó trong Environment, không phải giá trị trong file.',
  },
  {
    id: 'appUrl',
    want: true,
    read: (b) => String(b.appUrl || '').startsWith('https://'),
    label: 'APP_URL là https',
    // Canonical link, hreflang, sitemap, robots.txt và URL quay lại sau PayPal
    // đều lấy từ đây. Sai giao thức thì Google bị bảo trang sống ở một nơi
    // và được phục vụ ở nơi khác.
    fix: 'Đặt APP_URL=https://sonvudev.com (kể cả khi đang test trên onrender.com, cũng để tên miền thật nếu tên miền đã trỏ về).',
  },
  { id: 'momo', want: false, read: (b) => b.momo === true, label: 'MoMo (tuỳ chọn)', fix: 'Đặt MOMO_ACCOUNT_NUMBER để có. Không có thì cửa hàng vẫn chạy.' },
  { id: 'zalopay', want: false, read: (b) => b.zalopay === true, label: 'ZaloPay (tuỳ chọn)', fix: 'Đặt ZALOPAY_ACCOUNT_NUMBER để có.' },
];

/**
 * Turns a health payload into lines, without ever printing a secret.
 *
 * @param {object} body the parsed /api/health response
 * @returns {{lines: string[], failures: number}}
 */
export function report(body) {
  const lines = [];
  let failures = 0;
  for (const check of EXPECTED) {
    const has = Boolean(check.read(body));
    if (has) {
      lines.push({ state: 'ok', text: check.label });
      continue;
    }
    if (check.want) {
      failures += 1;
      lines.push({ state: 'fail', text: `${check.label} — ${check.fix}` });
    } else {
      lines.push({ state: 'skip', text: `${check.label} — chưa cấu hình, không ảnh hưởng gì` });
    }
  }
  return { lines, failures };
}

/**
 * Where to look when nothing is passed.
 *
 * Read from .env so the command works with no argument on a developer machine, and
 * resolves to a URL that is obvious when it guesses wrong.
 *
 * @returns {Promise<string>} a base URL, without a trailing slash
 */
const defaultBase = async () => {
  let raw = '';
  try {
    raw = await readFile(path.join(root, '.env'), 'utf8');
  } catch {
    raw = '';
  }
  return raw.match(/^APP_URL=(.*)$/m)?.[1]?.trim().replace(/\/$/, '') || 'http://localhost:3000';
};

/**
 * Fetches a health payload and prints the checklist.
 *
 * @param {string} [argument] a base URL, or undefined to read APP_URL from .env
 * @returns {Promise<number>} a process exit code
 */
export async function main(argument) {
  const base = (argument || '').trim().replace(/\/$/, '') || await defaultBase();
  const url = `${base}/api/health`;

  let body;
  let status;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    status = response.status;
    body = await response.json();
  } catch (error) {
    console.error(`Không gọi được ${url}: ${error.message}`);
    // Worth saying outright, because it is the first thing anyone sees when they
    // run this against a freshly deployed free instance: the request is not being
    // refused, the instance is still booting.
    console.error('Nếu đây là lần deploy đầu tiên, instance free đang thức — cho it nhat 60 giay rồi thử lại.');
    return 2;
  }

  const { lines, failures } = report(body);

  console.log(url);
  console.log(`HTTP ${status}  ok=${body.ok}  persistence=${body.persistence}  paypal=${body.paypalEnvironment}`);
  console.log(`uptime ${body.uptime}s  ${body.elapsedMs}ms\n`);
  for (const line of lines) {
    const mark = line.state === 'ok' ? '  OK  ' : line.state === 'skip' ? '  --  ' : '  XX  ';
    console.log(`${mark} ${line.text}`);
  }

  console.log('');
  if (status !== 200 || body.ok === false) {
    console.error(`Health tra HTTP ${status} / ok=${body.ok}. 503 nghia là một phần dang hong — xem "checks" trong JSON:`);
    console.error(JSON.stringify(body.checks));
  }
  if (failures) {
    console.error(`${failures} thieu thong tin. Khong co dong XX nao o tren la canh bao; dong XX moi la thu thieu.`);
    return 1;
  }
  console.log('Du tat ca cac dong bat buoc.');
  return 0;
}

// Run only when invoked, not when imported. test/health-check.test.js imports
// report() from here, and without this guard that import would fire a real
// request at localhost:3000 as a side effect of loading the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv[2]));
}
