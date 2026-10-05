// The image primitives both generators need, in one place.
//
// Why this file exists: the two generators grew out of a pair of PowerShell scripts
// that shared nothing — each had its own idea of how to read a PNG, recolour it and
// write one back, because PowerShell and System.Drawing made it the path of least
// resistance twice. Two implementations of "tint the alpha channel" is how the tab
// icon and the home-screen icon end up being different logos.
//
// System.Drawing is also Windows-only from .NET 6 onward — `Add-Type -AssemblyName
// System.Drawing` throws PlatformNotSupportedException on Linux and macOS, so the
// old generators could not run on the deploy host, on a Linux CI runner, or on a
// colleague's Mac. Everything here is pure JavaScript through pureimage, so a
// regenerate produces the same bytes on any machine that can run Node, which is the
// same bar every other tool in this repository is held to.
//
// A note on premultiplied alpha, because it caused the generators real trouble: it
// was the reason the tinting routine was rewritten pixel by pixel rather than through
// a colour matrix. getImageData/putImageData copies a raw byte buffer with no
// premultiply step, so writing B, G, R over a pixel whose alpha is non-zero cannot
// round-trip through anything that darkens a channel below its own alpha. Every tint
// here goes through those two calls and nothing else.
import P from 'pureimage';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';

/**
 * Decodes a PNG into a pureimage Bitmap.
 *
 * From a path rather than a buffer: pureimage's decoder takes a stream, and the one
 * Node accepts for a buffer is not the one it wants.
 *
 * @param {string} file absolute path
 * @returns {Promise<object>} pureimage Bitmap
 */
export const loadPng = (file) => P.decodePNGFromStream(createReadStream(file));

/**
 * Writes a Bitmap to disk as a PNG.
 *
 * @param {object} image pureimage Bitmap
 * @param {string} file absolute path
 */
export const savePng = (image, file) => P.encodePNGToStream(image, createWriteStream(file));

/**
 * A blank canvas of the given size, fully transparent.
 *
 * Not filled with anything. Every generator starts transparent and paints its own
 * background, because a background colour baked in here would then have to be
 * unpainted for the icons that must carry the platform's own — an iOS home screen
 * composites onto an opaque tile and ignores alpha entirely, which is why
 * apple-touch-icon paints one deliberately and the rest do not.
 *
 * @param {number} width
 * @param {number} height
 * @returns {object} pureimage Bitmap
 */
export const canvas = (width, height) => P.make(width, height);

/**
 * Scales an image into a square box, preserving alpha.
 *
 * @param {object} source pureimage Bitmap
 * @param {number} size target edge length in pixels
 * @returns {object} a new transparent Bitmap
 */
export const scaled = (source, size) => {
  const out = P.make(size, size);
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(source, 0, 0, size, size);
  return out;
};

/**
 * Recolours every non-transparent pixel, leaving alpha alone.
 *
 * The mark is one flat colour, so this is the only operation needed to produce the
 * light-on-dark and dark-on-light variants — the silhouette never changes, which is
 * what keeps them one logo rather than two drawings.
 *
 * @param {object} image mutated in place and returned
 * @param {{r: number, g: number, b: number}} rgb
 * @returns {object} the same Bitmap
 */
export const tint = (image, rgb) => {
  const ctx = image.getContext('2d');
  const data = ctx.getImageData(0, 0, image.width, image.height);
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    pixels[i] = rgb.r;
    pixels[i + 1] = rgb.g;
    pixels[i + 2] = rgb.b;
  }
  ctx.putImageData(data, 0, 0);
  return image;
};

/**
 * How much of a square the mark covers, in half-open units.
 *
 * Used as an assertion, not as artwork. A generator that silently produced an empty
 * or solid square would still exit 0 and commit a blank favicon; the coverage of the
 * source is a number that can be checked against the number that was there before.
 *
 * @param {object} image
 * @returns {number} 0..1
 */
export const coverage = (image) => {
  const ctx = image.getContext('2d');
  const data = ctx.getImageData(0, 0, image.width, image.height);
  const pixels = data.data;
  let covered = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    // Half weight for a partial pixel: anti-aliased edges are the difference between
    // a mark and a fringe, and counting them as fully covered would let a blur pass.
    if (pixels[i] > 0) covered += pixels[i] / 255;
  }
  return covered / (image.width * image.height);
};

/**
 * Registers a TTF and returns its family name for use in a `ctx.font` string.
 *
 * @param {string} file absolute path to a .ttf
 * @param {string} family
 * @returns {string} the family, so a caller cannot typo it into the font string
 */
export const loadFont = (file, family) => {
  const font = P.registerFont(file, family);
  font.loadSync();
  return family;
};

/**
 * The width of a string in the current context font.
 *
 * @param {object} ctx
 * @param {string} text
 * @returns {number} pixels
 */
export const widthOf = (ctx, text) => ctx.measureText(text).width;

/**
 * A filled rounded rectangle with a one-pixel antialiased edge.
 *
 * Built from a signed distance field rather than a path, because pureimage's path
 * fill is not usable for this: it logs "can't project the same paths" for every
 * segment of a rounded shape and leaves a visible diagonal seam across the middle of
 * it, and `ctx.roundRect` inherits the same fault. The SVG card in src/pages.js draws
 * these three pills with real browser arcs, so a seam on the raster card means the
 * one image most people outside the shop ever see disagrees with the site.
 *
 * The distance function is the standard one — the box distance outside the inner
 * rectangle, the Chebyshev-style negative distance inside it — so coverage is
 * `0.5 - d` and antialiasing falls out rather than being tuned.
 *
 * @param {object} ctx pureimage context
 * @param {{x: number, y: number, w: number, h: number, r: number}} box
 * @param {string} fill an rgb() or rgba() string
 */
export const pill = (ctx, box, fill) => {
  // Whole pixels throughout, and that is not cosmetic.
  //
  // The width passed in comes from ctx.measureText, so it is routinely fractional —
  // 169.286 for one of the three pills on the share card. getImageData then received
  // 171.286 and silently drew nothing: one lifted pixel out of 48,000, no error, and a
  // card with no pills on it that reported success. Rounding here rather than at the
  // call site means a fractional measurement cannot produce a silently empty shape.
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  const r = Math.min(box.r, w / 2, h / 2);
  const halfW = w / 2;
  const halfH = h / 2;
  const centreX = x + halfW;
  const centreY = y + halfH;
  const distance = (px, py) => {
    const qx = Math.abs(px - centreX) - (halfW - r);
    const qy = Math.abs(py - centreY) - (halfH - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  // Read the colour channels by position, not by skipping the first entry.
  //
  // This looked like a shorthand and was off by one: destructuring
  // `[, red, green, blue, alpha]` from a four-element array threw away the red
  // channel and defaulted alpha to 1, so a pill specified as
  // rgba(255,255,255,0.18) was drawn as opaque rgb(255,255,0.18) — and 0.18 rounds to
  // 0 in a byte, which is yellow. The share card came out with three yellow bars and
  // nothing anywhere reported an error, because every value written was a number and
  // the file was written.
  const [red, green, blue, alpha = 1] = /rgba?\(([^)]+)\)/.exec(fill)[1]
    .split(',')
    .map((value) => Number(value.trim()));
  // One pixel of margin, because the edge pixel of the box can still be partly covered.
  const region = ctx.getImageData(x - 1, y - 1, w + 2, h + 2);
  const pixels = region.data;
  const stride = w + 2;
  for (let py = 0; py < h + 2; py += 1) {
    for (let px = 0; px < stride; px += 1) {
      const cover = Math.min(1, Math.max(0, 0.5 - distance(x - 1 + px + 0.5, y - 1 + py + 0.5))) * alpha;
      if (cover <= 0) continue;
      const at = (py * stride + px) * 4;
      pixels[at] = Math.round(pixels[at] * (1 - cover) + red * cover);
      pixels[at + 1] = Math.round(pixels[at + 1] * (1 - cover) + green * cover);
      pixels[at + 2] = Math.round(pixels[at + 2] * (1 - cover) + blue * cover);
    }
  }
  ctx.putImageData(region, x - 1, y - 1);
};

/**
 * Builds a multi-size .ico, PNG-encoded entries.
 *
 * PNG entries rather than BMP ones because every Windows version since Vista reads
 * them and the format permits it: the ICO directory entry stores each dimension in
 * a single byte rather than two. A 48px BMP entry would need that byte to mean zero,
 * which is the one place the format is genuinely awkward.
 *
 * @param {Array<{size: number, png: Buffer}>} entries largest last
 * @returns {Buffer} the .ico file
 */
export const buildIco = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  for (const [index, entry] of entries.entries()) {
    const at = index * 16;
    // 256 or larger cannot be written in a byte, and the format says to write 0.
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0; // palette size
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  }
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
};

/**
 * Encodes a Bitmap to a PNG Buffer without writing it anywhere.
 *
 * @param {object} image
 * @returns {Promise<Buffer>}
 */
export const toPngBuffer = (image) => new Promise((resolve, reject) => {
  const chunks = [];
  // A PassThrough is the destination. pureimage's encoder resolves its promise only
  // when the writable side finishes, and feeding it a real stream is the documented
  // way to get there — calling it with no argument and listening for events does not
  // give a stream at all, which is the version of this that threw
  // "stream.on is not a function".
  const sink = new PassThrough();
  sink.on('data', (chunk) => chunks.push(chunk));
  sink.on('end', () => resolve(Buffer.concat(chunks)));
  sink.on('error', reject);
  P.encodePNGToStream(image, sink).catch(reject);
});

/**
 * Traces a mark into a single-path SVG on a square grid.
 *
 * The mark is rectilinear — drawn from rectangles, like pixel art — so sampling it
 * onto a grid and emitting the occupied cells reproduces it rather than
 * approximating it. Cells are merged into horizontal runs and written as one path:
 * about 115 runs and 2 KB, against a 7.7 KB base64 blob for the same image.
 *
 * The base64 route is what this replaced, and it is worth recording why it does not
 * work: an <image> element inside an SVG icon is read by Chrome and Firefox but
 * ignored by several others, which fall back to /favicon.ico or to nothing at all.
 * That is why the browser tab showed no logo while every file in the project was
 * present and correct. An SVG icon has to be shapes.
 *
 * @param {object} image source mark, any size
 * @param {{grid?: number, alphaMin?: number, threshold?: number, fill?: string, label?: string}} [options]
 * @returns {string} a complete <svg> document
 */
export const traceToSvg = (image, options = {}) => {
  const grid = options.grid || 64;
  const alphaMin = options.alphaMin ?? 110;
  const threshold = options.threshold ?? 0.42;
  const fill = options.fill || '#3f6a5c';
  const label = options.label || 'Logo';
  const ctx = image.getContext('2d');
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const cell = Math.round(image.width / grid);
  const step = 2; // Sample every other pixel: four times fewer reads, same edge.
  const opaqueAt = (x, y) => data[(y * image.width + x) * 4 + 3] >= alphaMin;
  const runs = [];
  for (let row = 0; row < grid; row += 1) {
    let x = 0;
    while (x < grid) {
      let hits = 0;
      let total = 0;
      for (let y = row * cell; y < row * cell + cell; y += step) {
        for (let cx = x * cell; cx < x * cell + cell; cx += step) {
          total += 1;
          if (opaqueAt(cx, y)) hits += 1;
        }
      }
      if (hits / total < threshold) { x += 1; continue; }
      // Extend right while the cell stays filled, so a run is one segment.
      let w = 0;
      while (x + w < grid) {
        let h2 = 0;
        let t2 = 0;
        for (let y = row * cell; y < row * cell + cell; y += step) {
          for (let cx = (x + w) * cell; cx < (x + w) * cell + cell; cx += step) {
            t2 += 1;
            if (opaqueAt(cx, y)) h2 += 1;
          }
        }
        if (h2 / t2 < threshold) break;
        w += 1;
      }
      runs.push(`M${x} ${row}h${w}v1h-${w}z`);
      x += w;
    }
  }
  const d = runs.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" width="${grid}" height="${grid}" role="img" aria-label="${label}"><path fill="${fill}" d="${d}"/></svg>\n`;
};

/**
 * Reads a value out of a .env file.
 *
 * Shared rather than repeated because the two generators both needed BRAND_NAME and
 * both reached for a different implementation: one used dotenv, one hand-parsed with
 * a regex that could not see a quoted value. A card announcing a name the storefront
 * does not use is the kind of thing nobody notices until a client screenshots it.
 *
 * @param {string} file
 * @param {string} key
 * @param {string} fallback
 * @returns {Promise<string>}
 */
export const envValue = async (file, key, fallback) => {
  try {
    const raw = await readFile(file, 'utf8');
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
    if (!line) return fallback;
    const value = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
    return value || fallback;
  } catch {
    return fallback;
  }
};

/**
 * Splits a brand name into the two halves the wordmark colours differently.
 *
 * The rule src/pages.js uses for the header, applied here so the share card and the
 * site colour the same two halves identically. It splits on the last capital that
 * starts a word — "SonVuDev" becomes "SonVu" and "Dev" — which is the same wordmark
 * the visitor already sees.
 *
 * @param {string} name
 * @returns {{head: string, tail: string}}
 */
export const splitWordmark = (name) => {
  for (let i = name.length - 1; i > 0; i -= 1) {
    if (/[A-Z]/.test(name[i]) && /[a-z0-9]/.test(name[i - 1])) {
      return { head: name.slice(0, i), tail: name.slice(i) };
    }
  }
  return { head: name, tail: '' };
};

export { writeFile as writeText };
