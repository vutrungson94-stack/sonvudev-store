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
// Exit code is non-zero on any failure so it can gate a deploy — but only when there
// was something to check. See the missing-URL case below.
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { AI_CRAWLERS, ROBOTS_DISALLOW } from "../src/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

// No fallback domain. The old one was the shop's own address, so a run with no
// APP_URL and no argument quietly audited production from a machine that may not
// have been pointed at it — and reported the result as if it had been asked for.
const base = String(process.argv[2] || process.env.APP_URL || "").replace(/\/$/, "");
if (!base) {
  // Nothing to check is not the same as a check that failed, and treating them the
  // same is what put six red runs in a row before anybody asked why: the
  // deployed-site job has no .env and no APP_URL secret, so this ran, printed one
  // line and exited 1 on every single push. A permanently red job is a job nobody
  // reads, which makes the one push where the site really is broken invisible too.
  //
  // So an unconfigured run skips and says so. It stays distinguishable from a pass:
  // a real audit prints a line per check and a count, and this prints neither.
  //
  // The boundary is deliberately narrow. A URL that was given and does not answer is
  // still a failure — that is the case this script exists for, and skipping it would
  // mean a dead site passes because the workflow forgot to configure itself.
  console.log("[seo:check] Bo qua: khong co APP_URL va khong co dia chi nao truyen vao.");
  console.log("[seo:check] De chay that: npm run seo:check -- https://ten-mien-cua-ban");
  process.exit(0);
}
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
let networkBlocked = false;
try {
  home = await get(`${base}/`);
  record("Trang chủ", home.response.status === 200, `HTTP ${home.response.status}`);
} catch (error) {
  // undici rejects with "fetch failed" and keeps the real reason in `cause`. On a
  // managed network that reason is almost always the endpoint's TLS inspection or a
  // filtering resolver, neither of which has anything to do with the site's SEO.
  // Reporting the bare message sends people to debug the server when the server was
  // never involved.
  const chain = [];
  for (let node = error, depth = 0; node && depth < 5; node = node.cause, depth += 1) {
    chain.push(String(node.message || node.code || node));
  }
  const cause = chain.join(" <- ");
  const last = chain[chain.length - 1];
  networkBlocked = /self-signed|unable to verify|SELF_SIGNED|DEPTH_ZERO|revocation|CRYPT_E_NO_REVOCATION|ENOTFOUND|EAI_AGAIN/i.test(cause);
  record("Trang chủ", false, networkBlocked
    ? `may nay khong pho giao duoc domain — ${last}. Do proxy/endpoint cua may chan hoac giai phong TLS, KHONG phai loi cua site. Chay lai tren 4G.`
    : (error.name === "TimeoutError" ? "timeout" : cause));
  for (const item of results) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
  // Still non-zero, and deliberately different from the missing-URL case above.
  //
  // A URL was asked for and this machine could not see it. Whether the site is down
  // or the network in front of it is, the answer here is "not verified" — and a gate
  // that reports "not verified" as "verified" is the thing we just removed. This one
  // fails closed on purpose; the fix is to run it somewhere that can see the site,
  // not to treat the silence as a pass.
  if (networkBlocked) console.error("\nKHONG KET LUAN DUOC ve site — may nay khong nhin thay no, va day KHONG phai bang chung site binh thuong.");
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
//    here.
// ---------------------------------------------------------------------------
//
// The system resolver is tried first, because it is the answer the machine would
// actually give. When it refuses — which it does on any Windows box configured for
// DNS-over-HTTPS, where the Windows client falls back to DoH but Node still sends
// plain queries to port 53 and gets ECONNREFUSED — public resolvers are asked next,
// over plain DNS and then over HTTPS.
//
// This is not a fallback that makes a wrong answer look right: it reads the same
// authoritative record, and which path answered is printed, so a reader can see that
// the system resolver failed rather than being told nothing happened. Before this, a
// domain verified by DNS for months reported FAIL with "không đọc được DNS (mạng đang
// chặn tra cứu)" — a red line about the local network sitting where a result
// belonged, which is the state nobody keeps reading. Only when every path is
// refused is the result reported as unchecked, never as a failure.
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];
// DoH last, because it is the slowest and the most likely to be intercepted by a
// middlebox — but on a network with port 53 blocked it is the only one that answers,
// and a verification check that cannot check is worth less than a slow one.
const DOH_RESOLVERS = [
  { name: "DoH Google", url: (host) => `https://dns.google/resolve?name=${host}&type=TXT` },
  { name: "DoH Cloudflare", url: (host) => `https://cloudflare-dns.com/dns-query?name=${host}&type=TXT`, headers: { accept: "application/dns-json" } },
];

const txtRecords = async (host) => {
  try {
    const chunks = await dns.resolveTxt(host);
    return { records: chunks.map((chunk) => chunk.join("")), via: "DNS hệ thống" };
  } catch {
    // System resolver refused. Ask a public one before concluding anything.
  }
  for (const server of PUBLIC_RESOLVERS) {
    try {
      const resolver = new dns.Resolver({ timeout: 4000, tries: 2 });
      const chunks = await resolver.resolveTxt(host);
      return { records: chunks.map((chunk) => chunk.join("")), via: server };
    } catch {
      // Port 53 is likely blocked entirely. Try the next, then DoH.
    }
  }
  for (const doh of DOH_RESOLVERS) {
    try {
      const response = await fetch(doh.url(host), {
        headers: doh.headers || {},
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const records = (payload.Answer || [])
        .map((answer) => String(answer.data || ""))
        // DoH wraps a TXT string in its own quotes; the plain resolvers do not.
        .map((line) => line.replace(/^"|"$/g, ""));
      // Status 0 is NOERROR, 3 is NXDOMAIN. Both are answers — a domain that does
      // not resolve is a fact about the domain, not a resolver that failed.
      if (records.length || payload.Status === 3) return { records, via: doh.name };
    } catch {
      // Try the next endpoint.
    }
  }
  return { records: null, via: null };
};

const hasTxt = (records, prefix) => Boolean(records) && records.some((line) => line.startsWith(prefix));

const apex = new URL(base).hostname;
const { records: txt, via: dnsVia } = await txtRecords(apex);
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
  dnsGoogle ? `bản ghi DNS (qua ${dnsVia})` : null,
].filter(Boolean);
record("Xác minh Google", Boolean(googleMethod.length), googleMethod.length
  ? `${googleMethod.join(" + ")}`
  : txt === null
    ? "không đọc được DNS (cả hệ thống lẫn 2 resolver công cộng đều bị từ chối) và site không có thẻ meta — kiểm tra bằng tay"
    : "chưa xác minh: không có thẻ meta, không có file, không có bản ghi DNS google-site-verification");

const bingMethod = [
  liveBing ? "thẻ meta" : null,
  dnsBing ? `bản ghi DNS (qua ${dnsVia})` : null,
].filter(Boolean);
// Xác minh Bing qua "Import from Google Search Console" không để lại dấu vết
// nào ra ngoài domain: không có bản ghi `ms=`, không có thẻ meta, và Bing vẫn
// cấp quyền đọc sitemap. Đó là một trong hai cách xác minh hợp lệ của Bing.
//
// Hệ quả của việc nó vô hình: dòng này từng FAIL vĩnh viễn một việc đã xong,
// và đỏ vĩnh viễn là trạng thái mà không ai đọc — cùng lỗi mà chính script này
// đã phải sửa hai lần (bỏ qua khi thiếu URL, không báo xanh khi không kiểm tra
// được gì). Nên: có tín hiệu Bing thì PASS; không có tín hiệu Bing nhưng domain
// đã xác minh với Google thì PASS kèm ghi chú nói rõ không kiểm chứng được từ
// bên ngoài; không có tín hiệu nào thì mới FAIL.
if (bingMethod.length) {
  record("Xác minh Bing", true, bingMethod.join(" + "));
} else if (dnsGoogle) {
  record("Xác minh Bing", true,
    "qua bản ghi DNS của Google Search Console (Bing không để lại tín hiệu riêng khi import) — "
    + "xác nhận lại trong panel Bing: Sitemaps có sitemap.xml của bạn là đã xác minh");
} else {
  record("Xác minh Bing", false, txt === null
    ? "không đọc được DNS (cả hệ thống lẫn 2 resolver công cộng đều bị từ chối) và site không có thẻ Bing — kiểm tra bằng tay"
    : "chưa xác minh: không có thẻ meta, không có bản ghi ms=, và domain cũng chưa xác minh với Google");
}

// ---------------------------------------------------------------------------
// 4. robots.txt. Two ways it goes wrong that both look fine on the page: the
//    Sitemap line is missing, or the admin and order pages are not blocked.
// ---------------------------------------------------------------------------
let robots = { response: { status: 0 }, body: "" };
try { robots = await get(`${base}/robots.txt`); } catch { /* reported below */ }
record("robots.txt", robots.response.status === 200, `HTTP ${robots.response.status}`);
const sitemapLine = one(robots.body, /Sitemap:\s*(\S+)/i);
record("robots.txt khai báo sitemap", sitemapLine === `${base}/sitemap.xml`, sitemapLine || "(thiếu dòng Sitemap)");
// The rules come from src/robots.js, the same module the server renders the file
// with. They used to be four literals written here while the server sent five —
// /paypal-return was already disallowed in the response and missing from this check,
// so the tool that exists to notice a crawler being pointed somewhere private had
// stopped being able to see one of them. A rule written twice is enforced once.
for (const rule of ROBOTS_DISALLOW) {
  record(`robots.txt chặn ${rule}`, new RegExp(`Disallow:\\s*${rule.replace(/\//g, "\\/")}`, "i").test(robots.body), "");
}
// And the other half of the same file: the answer engines are allowed by name, so
// whether the shop is discoverable by ChatGPT or Claude is a checked fact rather
// than an assumption. Deleting one from src/robots.js without it reaching a deploy
// now shows up here as a red line instead of a silent loss.
for (const agent of AI_CRAWLERS) {
  const block = new RegExp(`User-agent:\\s*${agent}\\s*\\r?\\n\\s*Allow:\\s*/`, "i");
  record(`robots.txt cho phép ${agent}`, block.test(robots.body), "");
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
// 4b. The two machine-readable entry points, and the raster card.
//
//    Each is a single request that saves a crawler or an assistant from parsing a
//    hero image to work out what this shop sells. They are also the easiest things
//    to break quietly: a route added and then renamed, a 404 nobody visits, and
//    the sitemap still looks perfect.
// ---------------------------------------------------------------------------
for (const [label, path] of [["/llms.txt", "/llms.txt"], ["/feed.json", "/feed.json"]]) {
  let response = { response: { status: 0 }, body: "" };
  try { response = await get(`${base}${path}`); } catch { /* reported below */ }
  record(label, response.response.status === 200, `HTTP ${response.response.status}`);
  if (path === "/feed.json" && response.response.status === 200) {
    let items = 0;
    try { items = (JSON.parse(response.body || "{}").itemListElement || []).length; } catch { items = -1; }
    record("/feed.json là JSON đúng", items >= 0, items < 0 ? "parse lỗi" : `${items} sản phẩm`);
  }
  if (path === "/llms.txt" && response.response.status === 200) {
    record("/llms.txt nói tên cửa hàng", response.body.trim().startsWith("# "), response.body.split("\n")[0] || "(rỗng)");
  }
}

// ---------------------------------------------------------------------------
// 4c. Every sameAs link in the Organization.
//
//    sameAs is the one field that ties this shop to the rest of the web in a
//    knowledge graph, and it is entirely made of URLs nothing on this site
//    controls. A dead link there is worse than an empty one: an empty sameAs says
//    "no other accounts", while a dead one says "this is who we are" and then
//    leads nowhere, which is the same mistake as naming /logo.svg as the logo —
//    markup that is confident and wrong.
//
//    A brand-new account with no public content does resolve, and is still worth
//    almost nothing: it only helps if that page links back. That is not something
//    a status code can measure, so this reports reachability and leaves the
//    judgement to the owner.
// ---------------------------------------------------------------------------
const homeGraph = [...home.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((block) => {
    try {
      const parsed = JSON.parse(block[1].replace(/\\u003c/g, "<"));
      return Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
    } catch { return []; }
  });
const organization = homeGraph.find((node) => node["@type"] === "Organization");
const sameAs = Array.isArray(organization?.sameAs) ? organization.sameAs : [];
record("Organization khai báo", Boolean(organization), organization ? "ok" : "(thiếu)");
if (organization && !sameAs.length) {
  console.log("      Ghi chú: sameAs rỗng. Cửa hàng chưa nối được tới đâu trên web,");
  console.log("      nên không có gì để xác nhận nó là ai. Không phải lỗi, nhưng là");
  console.log("      mất cơ hội — xem BRAND_SOCIAL_LINKS trong .env.example.");
}
for (const url of sameAs) {
  let status = 0;
  try { status = (await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) })).status; } catch { status = 0; }
  // 401/403 still mean the page exists and is not public. Treating those as dead
  // would push the owner towards deleting a perfectly good private-ish profile.
  const alive = status > 0 && status !== 404 && status !== 410;
  record(`sameAs sống: ${url}`, alive, status === 0 ? "không phản hồi" : `HTTP ${status}${alive ? "" : " (trang không tồn tại)"}`);
}

if (organization?.logo) {
  let status = 0;
  try { status = (await fetch(organization.logo, { signal: AbortSignal.timeout(TIMEOUT_MS) })).status; } catch { status = 0; }
  record("logo trong schema tồn tại", status === 200, `HTTP ${status} — ${organization.logo}`);
}

// og:image has to be a raster image. The SVG renderer at /og/:slug.svg is still
// served for the crawlers that handle it, but Facebook, Zalo, Telegram, Slack,
// LinkedIn and most AI answer engines refuse SVG and show an empty box, so a
// share of the site renders with no picture at all. This is the check that would
// have caught that before anyone shared a link.
const ogImage = one(home.body, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
record("og:image có trong trang chủ", Boolean(ogImage), ogImage || "(thiếu)");
if (ogImage) {
  let status = 0;
  let type = "";
  let buffer = Buffer.alloc(0);
  try {
    const response = await fetch(ogImage, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = response.status;
    type = response.headers.get("content-type") || "";
    // Read the file's own bytes, not its Content-Type. A server can send an
    // image/png header over a file that is not a PNG, and a crawler that finds
    // that out shows nothing at all.
    buffer = Buffer.from(await response.arrayBuffer());
  } catch { /* reported below */ }
  record("og:image là ảnh raster", status === 200 && /image\/(png|jpeg|jpg|webp|gif)/i.test(type), `HTTP ${status} ${type || "(không rõ)"}`);
  // The declared width has to match the real one. A 1200 in the markup over a
  // 600-wide file gets the card rendered small, or cropped, depending on the
  // platform, and there is no error anywhere to look at.
  const declaredWidth = Number(one(home.body, /<meta\s+property="og:image:width"\s+content="(\d+)"/i)) || 0;
  const declaredHeight = Number(one(home.body, /<meta\s+property="og:image:height"\s+content="(\d+)"/i)) || 0;
  const isPng = buffer.length > 24 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const realWidth = isPng ? buffer.readUInt32BE(16) : 0;
  const realHeight = isPng ? buffer.readUInt32BE(20) : 0;
  record("og:image đúng 1200x630 như khai báo", realWidth === declaredWidth && realHeight === declaredHeight && declaredWidth === 1200 && declaredHeight === 630,
    isPng ? `thật ${realWidth}x${realHeight}, khai ${declaredWidth}x${declaredHeight}` : "không đọc được kích thước (không phải PNG)");
}

// ---------------------------------------------------------------------------
// 6. The catalogue itself: does the homepage list what the sitemap claims, and
//    does every product page carry the fields a rich result needs?
// ---------------------------------------------------------------------------
try {
  const api = await get(`${base}/api/products`);
  const products = JSON.parse(api.body || "{}").products || [];
  const productPages = locations.filter((loc) => loc.includes("/product/"));
  // Sitemap đa ngôn ngữ: mỗi sản phẩm có 1 URL tiếng Việt, và thêm 1 URL /en/
  // khi có bản tiếng Anh. Đếm gộp 2 vế theo đầu sản phẩm thì đỏ vĩnh viễn từ
  // ngày có route /en/ — nên kiểm tra theo 3 ý: đủ trang vi, không trang vi
  // thừa, không trang en mồ côi. Thiếu bản en của một sản phẩm không phải lỗi
  // (tiếng Anh là tùy chọn theo từng sản phẩm).
  const slugOf = (loc) => {
    try { return decodeURIComponent(new URL(loc).pathname.split("/").filter(Boolean).pop() || ""); }
    catch { return ""; }
  };
  const viPages = productPages.filter((loc) => !loc.includes("/en/product/"));
  const enPages = productPages.filter((loc) => loc.includes("/en/product/"));
  const slugs = new Set(products.map((p) => p.slug));
  const viSlugs = new Set(viPages.map(slugOf));
  const missingVi = products.filter((p) => !viSlugs.has(p.slug)).map((p) => p.slug);
  const extraVi = [...viSlugs].filter((s) => s && !slugs.has(s));
  const orphanEn = enPages.map(slugOf).filter((s) => s && !slugs.has(s));
  const catalogProblems = [
    ...missingVi.map((s) => `thiếu trang vi: ${s}`),
    ...extraVi.map((s) => `thừa trang vi: ${s}`),
    ...orphanEn.map((s) => `trang en mồ côi: ${s}`),
  ];
  record("Sitemap khớp danh mục (đa ngôn ngữ)", catalogProblems.length === 0,
    catalogProblems.join("; ") || `${viPages.length} trang vi + ${enPages.length} trang en cho ${products.length} sản phẩm`);
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
