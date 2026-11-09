import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/env.mjs';

test('purchase/config contract: env helper giữ test cô lập và APP_URL hợp lệ', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.SUPABASE_URL, '');
  assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, '');
  assert.equal(process.env.RESEND_API_KEY, '');
  assert.equal(process.env.INDEXNOW_KEY, '');
  assert.match(String(process.env.APP_URL || ''), /^https?:\/\//);
});

test('purchase/config contract: blog buy intent chuẩn có thể nhận diện qua data-buy', async () => {
  const { renderBlogPost } = await import('../src/blog.js');
  const html = renderBlogPost({
    slug: 'cta', titleVi: 'CTA', titleEn: 'CTA', descriptionVi: 'd', descriptionEn: 'd',
    contentVi: '<a data-buy="1" href="/product/sp">Mua</a>',
    contentEn: '<a data-buy="1" href="/product/sp">Buy</a>',
    section: 'T', sectionEn: 'T', tags: [], relatedProductSlug: '', published: '2025-01-01T00:00:00.000Z', modified: '2025-01-01T00:00:00.000Z',
  }, 'vi');
  // No product id mapping in this isolated import context => safe fallback to product page is acceptable only when no id.
  // Contract: explicit buy CTA must never be treated as a silent no-op; it is rewritten by blog CTA policy.
  assert.ok(!html.includes('href="/product/sp"'), 'CTA mua data-buy phải được rewrite theo policy blog');
});
