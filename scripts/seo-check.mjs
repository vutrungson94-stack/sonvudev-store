// Reads the live site the way a crawler does, and reports what a search engine
// will actually find. Everything else in this repo checks the code; this checks
// the deployed bytes, which is the only thing Google indexes.
//
//   npm run seo:check                 against APP_URL from .env
//   npm run seo:check -- https://...  against any host
//
// Why it exists: a sitemap that lists a 404, a canonical pointing at the wrong
// host, a verification tag that never made it into the deploy, structured data
// with a broken price. None of those throw, none of them show up in a browser,
// and all of them are silent until traffic does not arrive. This turns them into
// a line of output with the URL on it.
//
// Exit code is non-zero on any failure so it can gate a deploy.
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const base = String(process.argv[2] || process.env.APP_URL || "https://sonvudev.com").replace(/\/$/, "");
const expectedToken = (process.env.GOOGLE_SITE_VERIFICATION || "").trim();
const TIMEOUT_MS = 12000;

const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

async function get(url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { response, body: response.ok ? await response.text() : "" };
}

const one = (html, pattern) => (html.match(pattern) || [])[1] || "";
const all = (html, pattern) => [...html.matchAll(pattern)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// 1. Reachability. A site that answers 500 is not an SEO problem, but reporting
//    it here saves opening the browser to find out.
// ---------------------------------------------------------------------------
let home;
try {
  home = await get(`${base}/`);
  record("Trang chủ", home.response.status === 200, `HTTP ${home.response.status}`);
} catch (error) {
  record("Trang chủ", false, error.name === "TimeoutError" ? "timeout" : error.message);
  for (const item of results) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. The homepage's own metadata.
// ---------------------------------------------------------------------------
const title = one(home.body, /<title>([^<]*)<\/title>/i);
const description = one(home.body, /<meta\s+name="description"\s+content="([^"]*)"/i);
const canonical = one(home.body, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
record("Tiêu đề trang chủ", title.length > 10 && title.length <= 70, `${title.length} ký tự — "${title}"`);
record("Mô tả trang chủ", description.length > 70 && description.length <= 175, `${description.length} ký tự`);
// Google truncates around 600px; a longer description is wasted text, a shorter
// one is wasted opportunity. Both are worth knowing before the click-through
// rate is blamed on the copy.
record("Canonical trang chủ", canonical.replace(/\/$/, "") === base, canonical || "(thiếu)");

// Two <title> or two <h1> and the page is arguing with itself. Google picks one.
const h1s = all(home.body, /<h1[^>]*>([\s\S]*?)<\/h1>/gi);
record("Một thẻ h1 duy nhất", h1s.length === 1, `${h1s.length} thẻ h1`);
record("Nội dung không cần JavaScript", /[a-zA-Zà-ỹ]{3,}/.test(h1s[0] || ""), "thẻ h1 phải có chữ trong HTML");

// ---------------------------------------------------------------------------
// 3. Domain ownership. Without this the site can be perfect and still invisible.
//
//    A domain can be claimed three ways, and which one was used decides what to
//    look for. The usual choice for a Domain property is a DNS TXT record, which
//    lives at the registrar and not on the site, so a check that only reads the
//    homepage would report a verified domain as unverified. Both are checked
//    here, and a resolver that cannot be reached is reported as "không tra
//    được" rather than as a failure — a wrong answer is worse than no answer.
// ---------------------------------------------------------------------------
const txtRecords = async (host) => {
  try {
    const chunks = await dns.resolveTxt(host);
    return chunks.map((chunk) => chunk.join(""));
  } catch {
    return null;
  }
};
const hasTxt = (records, prefix) => Boolean(records) && records.some((line) => line.startsWith(prefix));

const apex = new URL(base).hostname;
const txt = await txtRecords(apex);
const dnsGoogle = hasTxt(txt, "google-site-verification=");
const dnsBing = hasTxt(txt, "ms=");

const liveGoogle = one(home.body, /<meta\s+name="google-site-verification"\s+content="([^"]*)"/i);
const liveBing = one(home.body, /<meta\s+name="msvalidate\.01"\s+content="([^"]*)"/i);
const fileName = expectedToken ? `google${expectedToken}.html` : liveGoogle ? `google${liveGoogle}.html` : null;
const googleFile = fileName ? await get(`${base}/${fileName}`).catch(() => ({ response: { status: 0 }, body: "" })) : { response: { status: 0 }, body: "" };

const googleMethod = [
  liveGoogle ? "thẻ meta" : null,
  expectedToken && liveGoogle === expectedToken ? "khớp với .env" : null,
  googleFile.response.status === 200 ? "file HTML" : null,
  dnsGoogle ? "bản ghi DNS" : null,
].filter(Boolean);
record("Xác minh Google", Boolean(googleMethod.length), googleMethod.length
  ? `${googleMethod.join(" + ")}`
  : txt === null
    ? "không đọc được DNS (mạng đang chặn tra cứu) và site không có thẻ meta — kiểm tra bằng tay"
    : "chưa xác minh: không có thẻ meta, không có file, không có bản ghi DNS google-site-verification");

const bingMethod = [liveBing ? "thẻ meta" : null, dnsBing ? "bản ghi DNS" : null].filter(Boolean);
record("Xác minh Bing", Boolean(bingMethod.length), bingMethod.length
  ? `${bingMethod.join(" + ")}`
  : txt === null
    ? "không đọc được DNS (mạng đang chặn tra cứu) và site không có thẻ Bing"
    : "chưa xác minh: chưa đặt BING_SITE_VERIFICATION");

// ---------------------------------------------------------------------------
// 4. robots.txt. Two ways it goes wrong that both look fine on the page: the
//    Sitemap line is missing, or the admin and order pages are not blocked.
// ---------------------------------------------------------------------------
let robots = { response: { status: 0 }, body: "" };
try { robots = await get(`${base}/robots.txt`); } catch { /* reported below */ }
record("robots.txt", robots.response.status === 200, `HTTP ${robots.response.status}`);
const sitemapLine = one(robots.body, /Sitemap:\s*(\S+)/i);
record("robots.txt khai báo sitemap", sitemapLine === `${base}/sitemap.xml`, sitemapLine || "(thiếu dòng Sitemap)");
for (const rule of ["/admin", "/api/", "/order/", "/lookup"]) {
  record(`robots.txt chặn ${rule}`, new RegExp(`Disallow:\\s*${rule.replace(/\//g, "\\/")}`, "i").test(robots.body), "");
}

// ---------------------------------------------------------------------------
// 5. sitemap.xml, and then every URL inside it.
// ---------------------------------------------------------------------------
let sitemap = { response: { status: 0 }, body: "" };
try { sitemap = await get(`${base}/sitemap.xml`); } catch { /* reported below */ }
record("sitemap.xml", sitemap.response.status === 200, `HTTP ${sitemap.response.status}`);
const locations = all(sitemap.body, /<loc>([^<]+)<\/loc>/g);
record("sitemap có nội dung", locations.length > 0, `${locations.length} URL`);
// A sitemap is a list of promises. One that returns 404 makes the whole file
// look unreliable, and Google starts ignoring it.
const seen = new Set();
let duplicates = 0;
for (const loc of locations) {
  if (seen.has(loc)) duplicates += 1;
  seen.add(loc);
}
record("Không có URL trùng", duplicates === 0, duplicates ? `${duplicates} URL lặp` : "");
const wrongHost = locations.filter((loc) => !loc.startsWith(`${base}/`));
record("URL trong sitemap đúng domain", wrongHost.length === 0, wrongHost.slice(0, 3).join(", "));

const blockedPaths = [...robots.body.matchAll(/Disallow:\s*(\S+)/gi)].map((m) => m[1]);
const blockedInSitemap = locations.filter((loc) => blockedPaths.some((rule) => loc.startsWith(`${base}${rule}`)));
record("Không URL bị chặn nằm trong sitemap", blockedInSitemap.length === 0, blockedInSitemap.slice(0, 3).join(", "));

for (const loc of locations) {
  let status = 0;
  try { status = (await get(loc)).response.status; } catch { status = 0; }
  record(`URL sống: ${loc.replace(base, "") || "/"}`, status === 200, `HTTP ${status}`);
}

// ---------------------------------------------------------------------------
// 6. The catalogue itself: does the homepage list what the sitemap claims, and
//    does every product page carry the fields a rich result needs?
// ---------------------------------------------------------------------------
try {
  const api = await get(`${base}/api/products`);
  const products = JSON.parse(api.body || "{}").products || [];
  const productPages = locations.filter((loc) => loc.includes("/product/"));
  record("Sitemap khớp danh mục", productPages.length === products.length, `sitemap có ${productPages.length}, cửa hàng bán ${products.length}`);
  for (const loc of productPages) {
    const { body } = await get(loc);
    const name = loc.replace(`${base}/product/`, "");
    const price = JSON.parse(api.body || "{}").products.find((p) => encodeURIComponent(p.slug) === name)?.price;
    const canonicalHere = one(body, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const graph = blocks.flatMap((b) => { try { const p = JSON.parse(b[1].replace(/\\u003c/g, "<")); return p["@graph"] || p; } catch { return []; } });
    const software = graph.find((n) => n["@type"] === "SoftwareApplication");
    const problems = [];
    if ((body.match(/<title>/g) || []).length !== 1) problems.push("nhiều hơn một thẻ title");
    if (canonicalHere !== loc) problems.push(`canonical lệch (${canonicalHere || "thiếu"})`);
    if (!software) problems.push("thiếu SoftwareApplication");
    if (software && price !== undefined && Number(software.offers?.price) !== Number(price)) problems.push(`giá schema ${software.offers?.price} ≠ giá thật ${price}`);
    // The organization logo is a URL Google fetches. It was /logo.svg, a file
    // that never existed, and the page rendered perfectly anyway.
    const logo = graph.find((n) => n["@type"] === "Organization")?.logo;
    if (logo) {
      const logoStatus = (await get(logo)).response.status;
      if (logoStatus !== 200) problems.push(`logo schema trả HTTP ${logoStatus}`);
    }
    const og = one(body, /<meta property="og:image" content="([^"]*)"/i);
    if (og && (await get(og)).response.status !== 200) problems.push(`og:image không tải được`);
    record(`Trang sản phẩm ${name}`, problems.length === 0, problems.join("; ") || "đầy đủ");
  }
  // A crawler reads the catalogue from the landing page, so an empty grid there
  // means the site's products exist only in a sitemap: no prices, no headings,
  // and not one internal link from the page a visitor lands on.
  const grid = one(home.body, /<div class="product-grid" id="product-grid">([\s\S]*?)<\/div>\s*<\/section>/i) || one(home.body, /id="product-grid">([\s\S]*?)<div class="empty-state">/i);
  const cards = (home.body.match(/class="product-card"/g) || []).length;
  record("Trang chủ có sản phẩm trong HTML", !/loading-card/.test(home.body) && cards === products.length, `${cards} thẻ sản phẩm, cửa hàng bán ${products.length}`);
  record("Sản phẩm trên trang chủ có link thật", !cards || /href="[^"]*\/product\/[^"]+"/.test(home.body), cards ? `${cards} thẻ` : "không có thẻ nào");
} catch (error) {
  record("Đọc danh mục sản phẩm", false, error.message);
}

// ---------------------------------------------------------------------------
for (const item of results) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra SEO đạt.`);
if (failed.length) {
  console.log("\nCác mục FAIL là thứ Google nhìn thấy và không chấp nhận. Sửa trước khi kỳ vọng truy cập tăng.");
  process.exitCode = 1;
}
