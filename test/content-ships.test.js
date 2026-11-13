// Regression guard for "content that must ship is read from a runtime path".
//
// The failure this exists to stop: blog posts were in data/blog/. data/ is
// runtime state — it is excluded from the deploy artifact (scripts/lib/artifact.mjs)
// and rejected by deploy.sh. On the deployed server the directory did not exist,
// loadBlogPosts() caught the readdir error and returned [], so /blog rendered zero
// cards and every /blog/<slug> 404'd. Nothing failed in tests because the files
// were present on the developer machine. The rule: shipped content lives in src/
// or public/, never data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACT_DIRECTORIES } from '../scripts/lib/artifact.mjs';
import './helpers/env.mjs';
import { loadBlogPosts, getBlogPostBySlug, DEFAULT_BLOG_POSTS_DIR } from '../src/blog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('blog posts live in a directory that ships (src/ or public/)', () => {
  // The default is resolved from the module's own location, not from dataDir
  // (data/). A path that points at data/ is the bug this guards. Asserting the
  // resolved value rather than the source expression keeps an equivalent
  // refactor (new URL('./blog-posts', import.meta.url)) from failing the gate.
  const resolved = path.resolve(DEFAULT_BLOG_POSTS_DIR);
  assert.equal(resolved, path.join(root, 'src', 'blog-posts'),
    'BLOG_POSTS_DIR mặc định phải là src/blog-posts, không phải data/blog');
  assert.ok(!resolved.startsWith(path.join(root, 'data')),
    'BLOG_POSTS_DIR không được trỏ vào data/ — data/ không ship trong artifact');

  // The directory the module reads must actually exist and be non-empty.
  const blogDir = path.join(root, 'src', 'blog-posts');
  assert.ok(existsSync(blogDir), 'src/blog-posts phải tồn tại');
  const files = readdirSync(blogDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'src/blog-posts phải có ít nhất một bài viết');

  // And no post may live only under data/blog.
  assert.ok(!existsSync(path.join(root, 'data', 'blog', 'sua-loi-excel-macro.json')),
    'bài viết không được nằm trong data/blog (runtime-only, không ship)');
});

test('every shipped-content directory read by src/ is inside the artifact', () => {
  // src/ and public/ are in ARTIFACT_DIRECTORIES, so content under them ships.
  // This asserts the loader does not read from a path outside those roots.
  const shippedRoots = ARTIFACT_DIRECTORIES.map((d) => path.join(root, d));
  const isShipped = (p) => shippedRoots.some((r) => p === r || p.startsWith(r + path.sep));

  const blogDir = path.join(root, 'src', 'blog-posts');
  assert.ok(isShipped(blogDir), `src/blog-posts phải nằm trong artifact (${ARTIFACT_DIRECTORIES.join(', ')})`);
});

test('loadBlogPosts reads real posts, not an empty runtime directory', () => {
  // This is the behaviour that silently returned [] on the deployed server.
  const posts = loadBlogPosts();
  assert.ok(Array.isArray(posts), 'loadBlogPosts phải trả về mảng');
  assert.ok(posts.length > 0, 'loadBlogPosts phải trả về ít nhất một bài (không rỗng)');
  for (const post of posts) {
    assert.ok(post.slug, 'mỗi bài phải có slug');
    assert.ok(getBlogPostBySlug(post.slug), `getBlogPostBySlug phải tìm thấy ${post.slug}`);
  }
});