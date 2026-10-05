// Writes public/og.png — the raster link-preview card.
//
//   npm run assets:og
//
// Facebook, Zalo, Telegram, Slack, LinkedIn and most AI answer engines do not render
// SVG in og:image, so a card that looks perfect in a browser can show as a blank box
// everywhere it actually matters. The SVG card in src/pages.js stays for the surfaces
// that do handle it; this writes the one PNG every platform can display.
//
// The output is committed, so the build and the server need no image library at all.
// Regenerate only when the brand palette or the mark changes.
//
// It was a PowerShell script using System.Drawing, which meant it ran on Windows and
// nowhere else — not on the Linux deploy host, not on a Linux CI runner, not on a Mac —
// and it drew its text with Arial and Segoe UI, neither of which exists on the machine
// it was written on in a way that reproduces byte-for-byte. The font below is the same
// Space Grotesk the storefront loads, at a weight the npm package actually ships, so
// the card and the site are set in one typeface on every machine.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  canvas, envValue, loadFont, loadPng, pill, savePng, splitWordmark, widthOf,
} from './lib/image.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const W = 1200;
const H = 630;

// Colours lifted from public/styles.css so the card is not a different product.
const WHITE = 'rgb(255,255,255)';
const MINT = 'rgb(143,211,178)';
const MUTED = 'rgb(150,196,176)';
const CORAL = 'rgb(255,118,91)';

const img = canvas(W, H);
const ctx = img.getContext('2d');

// The brand typeface, from the same family the site loads. Registered rather than
// assumed: pureimage will happily accept a font string for a family it does not have
// and then draw nothing, so the card came out with the headline missing and no error.
const display = loadFont(
  require.resolve('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
  'Space Grotesk',
);

// Background: the same diagonal green the SVG card uses.
const background = ctx.createLinearGradient(0, 0, W, H);
background.addColorStop(0, 'rgb(15,42,34)');
background.addColorStop(1, 'rgb(22,58,47)');
ctx.fillStyle = background;
ctx.fillRect(0, 0, W, H);

// A soft light in the top right, faded rather than a flat circle so it reads as glow
// and not as a shape.
//
// Written out per pixel rather than as a clipped radial gradient, because pureimage
// has no ctx.ellipse — it throws "ellipse not yet supported". A circle approximated
// from four arcs would have been the alternative, and the approximation is visible on
// a 310px radius: the banding at the edge is exactly what this avoids. A quadratic
// falloff to zero at the rim is smooth by construction and costs one pass over the
// region.
{
  const cx = 1070;
  const cy = 180;
  const radius = 310;
  const target = { r: 34, g: 84, b: 68 };
  const peak = 0.35; // The alpha the old LinearGradientBrush used at its centre.
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
      // Blend towards the light colour, not add to it.
      //
      // Adding is what the first version did and it produced a green spotlight where
      // the card should have a barely-there sheen: the measured centre went from
      // rgb(22,59,47) in the committed card to rgb(33,112,90), twice the lift. Blending
      // towards a colour at a fraction of the way is what a gradient brush does, and
      // (1 - d)^2 reaches zero smoothly at the rim so there is no edge to see.
      const a = (1 - d) * (1 - d) * peak;
      const at = (y * w + x) * 4;
      p[at] = Math.round(p[at] + (target.r - p[at]) * a);
      p[at + 1] = Math.round(p[at + 1] + (target.g - p[at + 1]) * a);
      p[at + 2] = Math.round(p[at + 2] + (target.b - p[at + 2]) * a);
    }
  }
  ctx.putImageData(region, x0, y0);
}

// The brand mark: the shop's actual logo, drawn from public/logo-mint-512.png.
//
// This used to be a rounded square with the letter "S" painted into it, drawn here in
// code. That made the share card the one surface carrying a hand-drawn second version
// of the logo — the tab, the iOS icon and the home screen all showed the real mark,
// and the card that Facebook, Zalo and LinkedIn render showed a different one. The
// mark is a file now, and this reads it.
//
// logo-mint rather than the source mark. The card background is the brand dark, and the
// source mark is a flat #3f6a5c — 2.31:1 against it, below the 3:1 WCAG asks of a
// graphic that carries meaning, which is why the mark looked like it was not there at
// all. logo-mint is the same silhouette in --mint, 4.7:1 on this background.
const mark = await loadPng(path.join(publicDir, 'logo-mint-512.png'));
ctx.drawImage(mark, 90, 74, 74, 74);

// The brand name, from the same BRAND_NAME the site reads. It was a literal typed
// here and coloured to match the header, so renaming the shop updated the storefront
// and left the share card — the one image anybody outside the shop ever sees —
// announcing the old name.
const brandName = await envValue(path.join(root, '.env'), 'BRAND_NAME', 'SonVuDev');
const { head, tail } = splitWordmark(brandName);

ctx.font = `42pt ${display}`;
ctx.fillStyle = WHITE;
ctx.fillText(head, 180, 128);
if (tail) {
  // The tail starts where the head ended rather than at a guessed offset, so a name
  // twice as long does not overlap itself.
  ctx.fillStyle = CORAL;
  ctx.fillText(tail, 180 + widthOf(ctx, head), 128);
}

ctx.font = `18pt ${display}`;
ctx.fillStyle = MINT;
ctx.fillText('PHẦN MỀM WINDOWS CHO CÔNG VIỆC', 92, 218);

ctx.font = `64pt ${display}`;
ctx.fillStyle = WHITE;
ctx.fillText('Phần mềm tốt cho', 90, 314);
ctx.fillStyle = CORAL;
ctx.fillText('công việc tốt.', 90, 390);

ctx.font = `26pt ${display}`;
ctx.fillStyle = MUTED;
ctx.fillText('Tiện ích Windows tự viết: dễ cài đặt, minh bạch, cập nhật dài hạn.', 90, 454);

// The three things a buyer actually decides on, stated rather than decorated.
ctx.font = `21pt ${display}`;
let x = 90;
const pills = [];
for (const label of ['Mua một lần', 'Tải ngay sau khi thanh toán', 'Hoàn tiền nếu file lỗi']) {
  const w = widthOf(ctx, label);
  pills.push({ label, x, w: w + 44 });
  pill(ctx, { x, y: 512, w: w + 44, h: 46, r: 23 }, 'rgba(255,255,255,0.18)');
  ctx.fillStyle = 'rgb(244,252,228)';
  ctx.fillText(label, x + 22, 543);
  x += w + 44 + 14;
}

// Confirm the pills are actually in the pixels before the file is written.
//
// This is not belt-and-braces. The generator ran green and produced a card with no
// pills on it: the width passed to the drawing came from ctx.measureText and was
// 169.286, getImageData took that as a rectangle width and drew one lifted pixel out
// of 48,000, and nothing anywhere reported an error. A share card is the one image
// anybody outside the shop ever sees, and it is committed — so a generator that can
// silently omit part of it is worse than one that refuses to run.
{
  const probe = ctx.getImageData(90, 512, pills[pills.length - 1].x + pills[pills.length - 1].w - 90, 46).data;
  let lifted = 0;
  for (let i = 0; i < probe.length; i += 4) {
    if (probe[i] > 40 || probe[i + 1] > 75) lifted += 1;
  }
  // Roughly the area of the three pills, minus the text drawn over them.
  const expected = (pills.reduce((sum, p) => sum + p.w, 0) + (pills.length - 1) * 14) * 46 * 0.8;
  if (lifted < expected * 0.5) {
    throw new Error(`Chỉ vẽ được ${lifted}/${Math.round(expected)} pixel viên thuốc — có thể hình đã không được vẽ. Không ghi file.`);
  }
  console.log(`Viên thuốc: ${lifted} pixel nền sáng (mong đợi ~${Math.round(expected)})`);
}

await savePng(img, path.join(publicDir, 'og.png'));
console.log(`Đã ghi public/og.png (${W}x${H}), thương hiệu "${brandName}"`);
