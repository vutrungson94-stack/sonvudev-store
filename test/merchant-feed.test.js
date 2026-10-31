import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/env.mjs';

process.env.NODE_ENV = 'test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = await import('../scripts/generate-merchant-feed.mjs');

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sonvudev-merchant-'));
const originalProducts = path.join(root, 'data', 'products.json');
const originalEnv = process.env.DATA_DIR;

try {
  process.env.DATA_DIR = tempDir;
  await fs.copyFile(originalProducts, path.join(tempDir, 'products.json'));

  // Run the generator by importing it fresh with overridden env
  const { execSync } = await import('node:child_process');
  const out = execSync(`node scripts/generate-merchant-feed.mjs`, {
    cwd: root,
    env: { ...process.env },
    encoding: 'utf8',
  });

  const feedPath = path.join(root, 'publish-output', 'merchant-feed.tsv');
  const content = await fs.readFile(feedPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim());

  test('generates TSV with header', () => {
    assert.ok(lines[0].startsWith('id\ttitle\tdescription\tlink\timage_link\tprice\tavailability\tcondition\tbrand\tmpn\tproduct_type\tshipping'));
  });

  test('writes one data row per sellable product', async () => {
    const products = JSON.parse(await fs.readFile(originalProducts, 'utf8'));
    const sellable = products.filter((p) => p.status === 'active' && p.fileKey);
    assert.equal(lines.length - 1, sellable.length, `expected ${sellable.length} rows, got ${lines.length - 1}`);
  });

  test('every row has required fields populated', () => {
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      assert.ok(cols.length >= 12, `row has ${cols.length} columns`);
      for (const col of ['title', 'link', 'image_link', 'price', 'availability', 'condition', 'brand']) {
        const idx = ['id','title','description','link','image_link','price','availability','condition','brand','mpn','product_type','shipping'].indexOf(col);
        assert.ok(cols[idx]?.trim(), `missing ${col}`);
      }
    }
  });

  test('price includes currency', () => {
    const dataLine = lines[1];
    assert.match(dataLine, /\d+\.\d+\s+USD/);
  });

  test('no raw tabs or newlines inside fields', () => {
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      for (const col of cols) {
        assert.ok(!col.includes('\t'), 'field contains raw tab');
        assert.ok(!col.includes('\n'), 'field contains raw newline');
      }
    }
  });
} finally {
  process.env.DATA_DIR = originalEnv;
  await fs.rm(tempDir, { recursive: true, force: true });
}
