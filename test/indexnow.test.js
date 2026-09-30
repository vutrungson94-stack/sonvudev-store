import test from 'node:test';
import assert from 'node:assert/strict';

// IndexNow is the only part of this store that talks to a third party on its
// own initiative, so it gets its own tests: what gets sent, and what must never
// be allowed to fail a product save. The "no key configured" path lives in
// indexnow-off.test.js because the key is read once, at import.
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://sonvudev.com';
process.env.INDEXNOW_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6';

const { pingIndexNow, isIndexNowConfigured, isValidIndexNowKey, siteUrl } = await import('../src/indexnow.js');

const sent = (status = 200) => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: status < 300, status };
    },
  };
};

test('khoá phải đúng dạng trước khi dùng', () => {
  assert.equal(isValidIndexNowKey('a1b2c3d4e5f6a1b2c3d4e5f6'), true);
  // The key is fetched from a public path, so a value carrying a separator, a
  // space or a shell metacharacter would either 404 or escape to another route.
  for (const bad of ['', 'short', 'has space', 'has/slash', 'a1b2c3d4e5f6?x=1', 'a1b2c3d4e5f6#']) {
    assert.equal(isValidIndexNowKey(bad), false, `"${bad}" phải bị từ chối`);
  }
  assert.equal(isIndexNowConfigured(), true);
  assert.match(siteUrl('/sitemap.xml'), /^https:\/\/sonvudev\.com\/sitemap\.xml$/);
  assert.equal(siteUrl('terms'), 'https://sonvudev.com/terms', 'đường dẫn không có dấu gạch chéo phải tự được thêm');
});

test('ping gửi host, key và vị trí file key đúng chuẩn IndexNow', async () => {
  const probe = sent();
  const result = await pingIndexNow(['/', '/product/spark'], { fetchImpl: probe.fetchImpl });
  assert.equal(result.sent, true);
  assert.equal(result.count, 2);
  const [call] = probe.calls;
  assert.equal(call.url, 'https://api.indexnow.org/indexnow');
  assert.equal(call.body.host, 'sonvudev.com');
  assert.equal(call.body.key, 'a1b2c3d4e5f6a1b2c3d4e5f6');
  // keyLocation is how the receiver proves the site really owns the key. A wrong
  // path there comes back 422 and the ping is lost with nothing logged.
  assert.equal(call.body.keyLocation, 'https://sonvudev.com/a1b2c3d4e5f6a1b2c3d4e5f6.txt');
  assert.deepEqual(call.body.urlList, ['https://sonvudev.com/', 'https://sonvudev.com/product/spark']);
});

test('ping thất bại thì báo lý do chứ không ném lỗi ra ngoài', async () => {
  // 422 is the answer when the key file is missing or in the wrong place. It is
  // a setup problem the owner can fix, so it has to be visible, and it still must
  // never reach the request that saved the product.
  const rejected = await pingIndexNow(['/'], { fetchImpl: async () => ({ ok: false, status: 422 }) });
  assert.equal(rejected.sent, false);
  assert.equal(rejected.reason, 'http-422');
  const offline = await pingIndexNow(['/'], { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(offline.sent, false);
  assert.equal(offline.reason, 'network');
});

test('không gửi đường dẫn rỗng, không gửi trùng, không gửi đường dẫn ngoài site', async () => {
  const empty = await pingIndexNow([], { fetchImpl: async () => ({ ok: true, status: 200 }) });
  assert.equal(empty.reason, 'nothing-to-send');
  const probe = sent();
  await pingIndexNow(['/product/a', '/product/a', 'not-a-path', 'https://evil.example/x', '/product/b'], { fetchImpl: probe.fetchImpl });
  // Everything that is not a path on this site is dropped: a submission naming
  // another host is rejected outright, and one naming this host wrongly is how a
  // ping ends up telling a search engine about a page that does not exist.
  assert.deepEqual(probe.calls[0].body.urlList, ['https://sonvudev.com/product/a', 'https://sonvudev.com/product/b']);
});
