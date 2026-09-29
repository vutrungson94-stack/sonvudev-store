import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-test-'));
process.env.DATA_DIR = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET_NAME = 'test-private-bucket';
process.env.BANK_NAME = 'Test Bank';
process.env.BANK_ACCOUNT_NAME = 'SonVuDev Test';
process.env.BANK_ACCOUNT_NUMBER = '0123456789';
process.env.BANK_BIN = '970436';
process.env.MOMO_ACCOUNT_NUMBER = '0900000001';
process.env.MOMO_QR_IMAGE = '/img/test-momo-qr.png';
process.env.ZALOPAY_ACCOUNT_NUMBER = '0900000002';
process.env.ZALOPAY_QR_IMAGE = '/img/test-zalopay-qr.png';
process.env.PAYPAL_CURRENCY = 'USD';
process.env.PAYPAL_VND_TO_USD_RATE = '26000';
process.env.ADMIN_API_TOKEN = 'test-admin-token';
// Never let a real key in .env turn a test run into real email.
process.env.RESEND_API_KEY = '';
const { createApp } = await import('../src/app.js');
let server;
let base;
test.before(async () => { server = (await createApp()).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server?.close(); await fs.rm(tempDir, { recursive: true, force: true }); });
test('PayPal converts VND prices to configured USD', async () => { const { paypalChargeFor, paymentMatchesOrder } = await import('../src/paypal.js'); const charge = paypalChargeFor({ price: 99000, currency: 'VND' }); assert.equal(charge.currency, 'USD'); assert.equal(charge.amount, 3.81); const order = { id: 'SVD-TEST', amount: 99000, currency: 'VND' }; assert.equal(paymentMatchesOrder({ custom_id: order.id, amount: { currency_code: 'USD', value: '3.81' } }, order), true); assert.equal(paymentMatchesOrder({ custom_id: order.id, amount: { currency_code: 'USD', value: '9.99' } }, order), false); });
test('payment verification uses the amount frozen on the order', async () => { const { paymentMatchesOrder } = await import('../src/paypal.js'); const order = { id: 'SVD-FROZEN', amount: 149000, currency: 'VND', items: [{ paypalCurrency: 'USD', paypalAmount: 5.75 }] }; assert.equal(paymentMatchesOrder({ custom_id: order.id, amount: { currency_code: 'USD', value: '5.75' } }, order), true); assert.equal(paymentMatchesOrder({ custom_id: order.id, amount: { currency_code: 'USD', value: '5.70' } }, order), false); assert.equal(paymentMatchesOrder({ custom_id: order.id, amount: { currency_code: 'EUR', value: '5.75' } }, order), false); assert.equal(paymentMatchesOrder({ custom_id: 'SVD-OTHER', amount: { currency_code: 'USD', value: '5.75' } }, order), false); });
test('fixed rate config bypasses the network entirely', async () => { const { paypalChargeFor } = await import('../src/paypal.js'); assert.equal(paypalChargeFor({ price: 149000, currency: 'VND' }).amount, 5.74); });
test('health endpoint reports local persistence', async () => { const response = await fetch(`${base}/api/health`); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.ok, true); assert.equal(data.persistence, 'local-json'); });
test('public catalog hides products without a release file', async () => { const response = await fetch(`${base}/api/products`); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.products.length, 0); assert.ok(data.products.every((product) => product.fileKey === undefined && product.file_key === undefined)); });
test('checkout rejects a product without a release file', async () => { const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'sonvu-starter', email: 'test@example.com', customerName: 'Test User', paymentMethod: 'bank_transfer' }) }); assert.equal(response.status, 503); });
test('admin API rejects missing token', async () => { const response = await fetch(`${base}/api/admin/orders`); assert.equal(response.status, 401); });

test('wallet QR images are served from public/img as PNG', async () => { for (const name of ['momo-qrcode-receving-money.png', 'zalopay-qrcode-receving-money.png']) { const response = await fetch(`${base}/img/${name}`); assert.equal(response.status, 200, name); assert.equal(response.headers.get('content-type'), 'image/png', name); const buffer = Buffer.from(await response.arrayBuffer()); assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name); assert.ok(buffer.length > 1000, `${name} looks empty`); } });

test('admin can publish a product and checkout creates a private order', async () => { const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' }; const created = await fetch(`${base}/api/admin/products`, { method: 'POST', headers, body: JSON.stringify({ name: 'Spark Capacity Tester', shortDescription: 'Kiểm tra dung lượng thật', description: 'Bản phát hành', category: 'Công cụ', platform: 'Windows', version: '1.4.0', price: 99000, currency: 'VND', features: ['Quick Size Test'], requirements: 'Windows 10/11', fileKey: 'products/spark/1.4.0/test-SparkCapacityTester.exe', status: 'active', badge: 'Mới' }) }); assert.equal(created.status, 201); const product = (await created.json()).product; const response = await fetch(`${base}/api/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, email: 'buyer@example.com', customerName: 'Test User', paymentMethod: 'bank_transfer' }) }); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.order.status, 'pending_transfer'); assert.equal(data.accessToken.length, 48); assert.equal(data.order.accessTokenHash, undefined); assert.equal(data.payment.bankName, 'Test Bank'); assert.equal(data.payment.accountNumber, '0123456789'); assert.equal(data.payment.transferNote, `SonVuDev ${data.order.id}`); assert.match(data.payment.qrUrl, /^https:\/\/img\.vietqr\.io\/image\/970436-0123456789-compact2\.png\?/); const ids=data.payment.channels.map(c=>c.id); assert.deepEqual(ids,['bank','momo','zalopay']); const [bank,momo]=data.payment.channels; assert.match(bank.qrUrl,/img\.vietqr\.io/); assert.equal(bank.account,'0123456789'); assert.equal(bank.transferNote,`SonVuDev ${data.order.id}`); assert.equal(momo.account,'0900000001'); assert.equal(momo.amount,99000); assert.equal(momo.qrImage,'/img/test-momo-qr.png'); assert.match(momo.qrHint,/tự nhập số tiền/); assert.equal(data.payment.wallets,undefined); const [,,zalopay]=data.payment.channels; assert.equal(zalopay.qrImage,'/img/test-zalopay-qr.png'); assert.equal(zalopay.account,'0900000002'); const lookup = await fetch(`${base}/api/orders/${data.order.id}`, { headers: { 'x-order-token': data.accessToken } }); assert.equal(lookup.status, 200); const looked = await lookup.json(); assert.equal(looked.payment.transferNote, `SonVuDev ${data.order.id}`); });
