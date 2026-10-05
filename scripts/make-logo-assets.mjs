// Generates every icon and logo asset the site needs from one source file.
//
//   npm run assets:logo
//
// Why this exists: the mark used to live in exactly one place, public/favicon.svg, and
// that one file was doing five jobs — browser tab, schema.org Organization.logo, and
// the three nobody had built yet. A 64x64 SVG is a poor answer to Google, which asks
// for at least 112x112, and no answer at all to an iPhone home screen, a Windows
// taskbar, an installed PWA or a browser that will not render SVG favicons.
//
// So there is one source — public/img/sonvudev.logo.png — and everything else is
// derived from it here. Replace the source, run this, and every slot a logo can
// occupy is updated together. Nothing is hand-drawn a second time.
//
// The output is committed on purpose: the build and the server then need no image
// library at all, and a deploy is a file copy rather than a step that can fail on a
// machine without one.
//
// Every size written here is a size a slot consumes — a <link rel="icon"> with that
// exact sizes attribute, an entry in the webmanifest, or an input to the share card.
// Five PNGs were being generated and referenced by nothing, and shipped in every
// artifact, until test/logo.test.js started holding this file to the other direction.
//
// It was a PowerShell script, and that was its own problem. System.Drawing is
// Windows-only from .NET 6 onward, so `Add-Type -AssemblyName System.Drawing` throws
// on Linux and macOS — the generator could not run on the deploy host, on a Linux CI
// runner, or on a colleague's Mac, and it used literal backslashes in its output
// paths besides. It is Node now, so a regenerate produces the same bytes anywhere
// Node runs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIco, canvas, coverage, envValue, loadPng, savePng, scaled, tint, toPngBuffer, traceToSvg, writeText,
} from './lib/image.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

// Lifted from public/styles.css and src/pages.js so the icons, the card and the
// storefront are one brand rather than three shades of green.
const BRAND_DARK = { r: 15, g: 42, b: 34 };   // #0f2a22
const INK = { r: 13, g: 107, b: 77 };         // --green, 3.3:1 on paper
const MINT_ON_DARK = { r: 200, g: 244, b: 220 }; // --mint, 4.7:1 on --dark

const written = [];
const record = (relative, detail) => {
  written.push({ relative, detail });
  console.log(`  ${relative.padEnd(30)} ${detail}`);
};

const source = path.join(publicDir, 'img', 'sonvudev.logo.png');
let mark;
try {
  mark = await loadPng(source);
} catch (error) {
  throw new Error(`Không đọc được file ngu��n logo: ${source}\n${error.message}`);
}
console.log(`Nguồn: public/img/sonvudev.logo.png (${mark.width}x${mark.height})`);

// The shape must be present. A generator that produced an empty or solid square would
// still exit 0 and commit a blank favicon, and the next person to see it would
// assume it was deliberate.
const filled = coverage(mark);
if (filled < 0.1 || filled > 0.9) {
  throw new Error(`File nguồn che ${(filled * 100).toFixed(1)}% khung — một logo thật che khoảng 38%. Không phải lỗi của bộ sinh ảnh.`);
}

// ---------------------------------------------------------------- transparent set
// Kept transparent so the mark sits on whatever background the platform gives it.
//
// 180 is absent because apple-touch-icon is that size and a second 180px file no slot
// points at is a file nothing loads. 48 is absent because favicon.ico embeds 48
// internally. 64 is absent because favicon.svg is a 64-unit vector and a raster twin
// of it served nothing. All three were generated, committed, listed in the build's
// required files and shipped in every artifact.
for (const size of [16, 32, 192, 512]) {
  const file = `icon-${size}.png`;
  await savePng(scaled(mark, size), path.join(publicDir, file));
  record(`public/${file}`, `${size}x${size}`);
}

// A copy at the source size, because schema.org and Google want the largest honest
// logo the shop can publish rather than a downscaled one.
await savePng(scaled(mark, 1024), path.join(publicDir, 'logo-1024.png'));
record('public/logo-1024.png', '1024x1024');

// ------------------------------------------------------------ apple-touch-icon
// iOS composites a home-screen icon onto an opaque tile and ignores the alpha
// channel, so a transparent icon renders as a black square with a mark floating in
// it. The brand background is painted in first for exactly that reason.
{
  const size = 180;
  const tile = canvas(size, size);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = `rgb(${BRAND_DARK.r},${BRAND_DARK.g},${BRAND_DARK.b})`;
  ctx.fillRect(0, 0, size, size);
  // 82% of the tile, the ratio Apple's own template uses, so the mark is not cropped
  // by the rounded-corner mask.
  const pad = Math.round(size * 0.09);
  ctx.drawImage(scaled(mark, size - pad * 2), pad, pad);
  await savePng(tile, path.join(publicDir, 'apple-touch-icon.png'));
  record('public/apple-touch-icon.png', `${size}x${size}, nền brand dark`);
}

// -------------------------------------------------------------------- favicon.ico
// The multi-size ICO Windows still asks for, PNG-encoded. See buildIco for why.
{
  const entries = [];
  for (const size of [16, 32, 48]) {
    entries.push({ size, png: await toPngBuffer(scaled(mark, size)) });
  }
  const ico = buildIco(entries);
  await writeText(path.join(publicDir, 'favicon.ico'), ico);
  record('public/favicon.ico', `${entries.length} sizes, ${ico.length} bytes`);
}

// ------------------------------------------------------------------ favicon.svg
{
  const svg = traceToSvg(mark);
  await writeText(path.join(publicDir, 'favicon.svg'), svg);
  const runs = (svg.match(/M\d+ /g) || []).length;
  record('public/favicon.svg', `${runs} runs, ${svg.length} bytes vector`);
}

// ------------------------------------------------------------- monochrome mask
// Safari pinned tabs take a single-colour silhouette and recolour it to the user's
// toolbar, so a full-colour mark is invisible there. The alpha channel already is
// the mark's silhouette, so tinting it is the whole operation.
{
  const mono = tint(scaled(mark, 512), BRAND_DARK);
  const small = scaled(mono, 64);
  await savePng(small, path.join(publicDir, 'mask-icon.png'));
  record('public/mask-icon.png', '64x64, một màu');
}

// ------------------------------------------------------- contrast-correct variants
// The mark is one flat colour: #3f6a5c, measured. That single colour is too close to
// both surfaces it sits on — 2.71:1 on the paper-white header and 2.31:1 on the dark
// share card — and WCAG asks for 3:1 for a graphic that carries meaning. So the shape
// gets two tints, derived from the same alpha silhouette rather than redrawn:
//
//   logo-ink-64.png    #0d6b4d  3.3:1 on paper   for light surfaces (the site header)
//   logo-mint-512.png  #c8f4dc  4.7:1 on dark    the input to the share card
//
// The silhouette never changes, so these are still one logo. A second drawn variant is
// how the header mark and the share card end up being different logos.
{
  await savePng(tint(scaled(mark, 64), INK), path.join(publicDir, 'logo-ink-64.png'));
  record('public/logo-ink-64.png', '64x64, #0d6b4d');

  await savePng(tint(scaled(mark, 512), MINT_ON_DARK), path.join(publicDir, 'logo-mint-512.png'));
  record('public/logo-mint-512.png', '512x512, #c8f4dc');
}

// The brand name is read from the same BRAND_NAME the site reads. It was a literal
// typed into the share-card generator, so renaming the shop updated the storefront and
// left the one image anybody outside the shop ever sees announcing the old name.
const brandName = await envValue(path.join(root, '.env'), 'BRAND_NAME', 'SonVuDev');
console.log(`\nThương hiệu đọc từ .env: ${brandName}`);

console.log(`\nXong. ${written.length} file trong public/. Commit chúng cùng với file nguồn logo.`);
