// End-to-end purchase flow against a real server process.
//
// The unit tests prove each module in isolation; this proves the shop as a
// buyer meets it: boot, catalogue, product page in two locales, create an
// order, read it back with the order token. It spawns `src/server.js` with the
// shared test environment and a temporary DATA_DIR, so it writes nothing to the
// repository and needs no network.
//
//   npm run e2e:check
//
// Exit 0 only when every step passes. The server's stderr is printed on
// failure, because a boot error and a checkout error look identical from here.
import { startFixtureServer, waitForHealth } from './lib/fixture-server.mjs';

const fixture = await startFixtureServer();
const { baseUrl, adminToken } = fixture;

const request = async (pathName, options = {}) => {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, text };
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  const serverReady = await waitForHealth(baseUrl, adminToken);
  assert(serverReady, `server không khởi động sau 15s:\n${fixture.getLog()}`);

  const home = await request('/');
  assert(home.status === 200, `GET / -> ${home.status}`);
  assert(/SonVuDev/.test(home.text), 'trang chủ không chứa tên thương hiệu');

  const products = await request('/api/products');
  assert(products.status === 200, `GET /api/products -> ${products.status}`);
  assert(Array.isArray(products.body?.products), '/api/products không trả về products[]');

  const slug = `e2e-${process.pid}`;
  const created = await request('/api/admin/products', {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
    body: JSON.stringify({
      name: 'E2E Probe',
      slug,
      price: 1000,
      currency: 'VND',
      fileKey: 'test/e2e.zip',
      status: 'active',
      shortDescription: 'Temporary product created by the E2E gate.',
      description: 'Temporary product created by the E2E gate.',
    }),
  });
  assert(created.status === 201, `POST /api/admin/products -> ${created.status}: ${created.text.slice(0, 200)}`);
  const productId = created.body?.product?.id;
  assert(productId, 'tạo sản phẩm không trả về id');

  const viPage = await request(`/product/${slug}`);
  assert(viPage.status === 200, `GET /product/${slug} -> ${viPage.status}`);
  assert(/E2E Probe/.test(viPage.text), 'trang sản phẩm không chứa tên sản phẩm');

  const enPage = await request(`/en/product/${slug}`);
  assert(enPage.status === 200, `GET /en/product/${slug} -> ${enPage.status}`);

  const checkout = await request('/api/checkout', {
    method: 'POST',
    body: JSON.stringify({
      email: `e2e-${process.pid}@example.com`,
      productId,
      paymentMethod: 'bank_transfer',
      acceptPolicy: true,
    }),
  });
  assert(checkout.status === 200, `POST /api/checkout -> ${checkout.status}: ${checkout.text.slice(0, 300)}`);
  const orderId = checkout.body?.order?.id;
  const accessToken = checkout.body?.accessToken;
  assert(orderId && accessToken, 'checkout không trả về order id / access token');

  const order = await request(`/api/orders/${orderId}`, {
    headers: { 'x-order-token': accessToken },
  });
  assert(order.status === 200, `GET /api/orders/:id -> ${order.status}`);
  assert(order.body?.order?.id === orderId, 'đọc lại đơn không khớp id');

  const blog = await request('/blog.json');
  assert(blog.status === 200, `GET /blog.json -> ${blog.status}`);
  assert(Array.isArray(blog.body?.items), '/blog.json không có items');

  console.log(`[e2e] PASS — home, products, vi/en product page, checkout, order read-back, blog feed (${baseUrl})`);
} catch (error) {
  console.error(`[e2e] FAIL — ${error.message}`);
  if (fixture.getLog()) console.error(fixture.getLog().slice(-4000));
  process.exitCode = 1;
} finally {
  await fixture.stop();
}