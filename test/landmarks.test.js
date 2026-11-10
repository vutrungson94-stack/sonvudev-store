// The shop's test environment, applied before anything imports src/ — config.js
// reads the environment once at load, so this has to come first.
import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

// The accessibility tree is what a screen reader walks and what an agent walks
// when it reads the page instead of scraping it. Two rules decide whether that
// tree is well formed, and both of them were broken here:
//
//   "region" — every piece of content belongs to a landmark. The announcement
//   bar sits above the header and belongs to none, so it was invisible to
//   anything that navigates by landmark.
//
//   "landmark-complementary-is-top-level" — a complementary landmark (aside)
//   that sits inside another landmark is two regions overlapping. The buy card
//   was an aside inside the banner.
//
// Neither shows in the markup as an error, and neither is caught by a syntax
// check. They are only visible to something that reads the parsed page, which
// is what the checks below do with the source that produces it.
test('mọi nội dung của trang đều nằm trong một landmark', async () => {
  const index = await read(path.join('public', 'index.html'));
  assert.match(index, /<aside class="announcement">/,
    'dải thông báo phải là một landmark (aside) — nội dung ngoài mọi landmark không có ai đọc tới');
  assert.match(index, /<\/aside>/,
    'dải thông báo phải đóng bằng </aside>');
});

test('thẻ mua hàng không phải landmark lồng trong landmark', async () => {
  const pages = await read(path.join('src', 'pages.js'));
  assert.match(pages, /<div class="buy-card" id="mua">/,
    'thẻ mua hàng phải là div — aside lồng trong header là hai vùng chồng lên nhau');
  assert.ok(!/<aside class="buy-card"/.test(pages),
    'thẻ mua hàng không được là aside: nó nằm trong banner, không phải một vùng riêng');
});
