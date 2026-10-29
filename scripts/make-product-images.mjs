// Writes one PNG per product into public/og/<slug>.png.
//
//   npm run assets:products
//
// Why this exists: every product page used to declare the same brand logo as its
// product image. Merchant Center reads that as "the image does not show the
// product" — a generic mark repeated across a catalogue is not an image of
// anything in particular, and the one shared card the shop had (public/og.png)
// also carried a promotional sentence, which the image policy forbids outright.
//
// This generator draws a clean cover per product: the product's own name, its
// platform and its version, on the brand background. No price, no discount, no
// deadline — the three things Google rejects in an image and the three things the
// old card had. For software, Google's category guidance accepts box art or a
// cover; a real screenshot of the running app is still better, and a product that
// carries an `imageUrl` in the catalogue overrides this file entirely.
//
// The catalogue is read from the live API by default so a product added in the
// admin panel gets a cover without editing this script. The seed file is the
// fallback for an offline machine and for CI, where the shop is not reachable.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import {
  canvas, envValue, loadFont, savePng, splitWordmark, widthOf,
} from './lib/image.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const outDir = path.join(publicDir, 'og');

const W = 1200;
const H = 630;

const WHITE = 'rgb(255,255,255)';
const MINT = 'rgb(143,211,178)';
const CORAL = 'rgb(255,118,91)';

const display = loadFont(
  require.resolve('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
  'Space Grotesk',
);

const brandName = await envValue(path.join(root, '.env'), 'BRAND_NAME', 'SonVuDev');

// The shop's own address comes from APP_URL — the same variable the server and
// the audit read. It is deliberately not written down here: a literal host is
// what the audit rejects (a copy drifts the moment the domain changes), and the
// catalogue this script draws from must be the one the shop actually serves.
const appUrl = (process.env.APP_URL || await envValue(path.join(root, '.env'), 'APP_URL', ''))
  .trim()
  .replace(/\/+$/, '');

/**
 * The catalogue to draw, live first.
 *
 * A failed request is not an error: the generator runs on machines with no
 * network and in CI where the shop is not deployed yet, and the seed file is a
 * complete catalogue for both. With no APP_URL there is nowhere to ask, so the
 * seed file is used directly rather than guessing a host.
 */
const loadProducts = async () => {
  const source = process.env.PRODUCT_SOURCE || (appUrl ? `${appUrl}/api/products` : '');
  if (!source) {
    console.warn('[catalogue] APP_URL is not set; using data/products.json');
    return JSON.parse(await readFile(path.join(root, 'data', 'products.json'), 'utf8'));
  }
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const products = Array.isArray(payload) ? payload : payload.products;
    if (Array.isArray(products) && products.length) return products;
    throw new Error('empty catalogue');
  } catch (error) {
    console.warn(`[catalogue] ${source} unavailable (${error.message}); using data/products.json`);
    return JSON.parse(await readFile(path.join(root, 'data', 'products.json'), 'utf8'));
  }
};

/** Greedy word wrap against the current context font. */
const wrap = (ctx, text, maxWidth, maxLines) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (widthOf(ctx, next) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Anything that did not fit is dropped rather than drawn over the edge. The
  // card is an image, not a page: a clipped word is worse than a shorter name.
  return lines;
};

const drawCard = (product) => {
  const img = canvas(W, H);
  const ctx = img.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, 'rgb(15,42,34)');
  background.addColorStop(1, 'rgb(22,58,47)');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  // The same soft sheen the share card uses. Written per pixel because pureimage
  // has no ellipse and a clipped radial gradient leaves a visible edge.
  {
    const cx = 1040;
    const cy = 150;
    const radius = 300;
    const target = { r: 34, g: 84, b: 68 };
    const peak = 0.3;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const w = Math.min(img.width - x0, Math.ceil(radius * 2));
    const h = Math.min(img.height - y0, Math.ceil(radius * 2));
    const region = ctx.getImageData(x0, y0, w, h);
    const p = region.data;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const dx = (x0 + x) - cx;
        const dy = (y0 + y) - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / radius;
        if (d >= 1) continue;
        const a = (1 - d) * (1 - d) * peak;
        const at = (y * w + x) * 4;
        p[at] = Math.round(p[at] + (target.r - p[at]) * a);
        p[at + 1] = Math.round(p[at + 1] + (target.g - p[at + 1]) * a);
        p[at + 2] = Math.round(p[at + 2] + (target.b - p[at + 2]) * a);
      }
    }
    ctx.putImageData(region, x0, y0);
  }

  // Brand line, from the same BRAND_NAME the storefront reads.
  const { head, tail } = splitWordmark(brandName);
  ctx.font = `26pt ${display}`;
  ctx.fillStyle = WHITE;
  ctx.fillText(head, 90, 96);
  if (tail) {
    ctx.fillStyle = CORAL;
    ctx.fillText(tail, 90 + widthOf(ctx, head), 96);
  }

  // A hairline under the brand line, so the cover reads as a cover and not as a
  // screenshot with a caption.
  ctx.fillStyle = 'rgb(38,86,70)';
  ctx.fillRect(90, 130, W - 180, 2);

  // Product name: the largest thing on the card, wrapped to two lines.
  ctx.font = `58pt ${display}`;
  ctx.fillStyle = WHITE;
  const nameLines = wrap(ctx, product.name || product.slug || 'Product', W - 180, 2);
  nameLines.forEach((line, index) => {
    ctx.fillText(line, 90, 280 + index * 78);
  });

  // Platform and version, the two facts a buyer checks first.
  const meta = [product.platform, product.version && `v${product.version}`].filter(Boolean).join(' · ');
  if (meta) {
    ctx.font = `22pt ${display}`;
    ctx.fillStyle = MINT;
    ctx.fillText(meta, 90, 280 + nameLines.length * 78 + 18);
  }

  // No category line. The column is free text in whichever language the owner
  // typed, so it put Vietnamese under an English cover — and a product image is
  // read by people on both language pages. Name, platform and version are the
  // three facts that are the same in every language the shop sells in.

  return img;
};

const products = await loadProducts();
await mkdir(outDir, { recursive: true });

let written = 0;
for (const product of products) {
  const slug = String(product.slug || '').trim();
  // Slugs are used as file names, so anything that could escape the directory is
  // skipped rather than sanitised into a name the route would not serve.
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    console.warn(`[skip] unusable slug: ${JSON.stringify(slug)}`);
    continue;
  }
  await savePng(drawCard(product), path.join(outDir, `${slug}.png`));
  written += 1;
  console.log(`[cover] public/og/${slug}.png`);
}

console.log(`Wrote ${written} product cover(s) at ${W}x${H}.`);
