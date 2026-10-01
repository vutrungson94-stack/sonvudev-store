// Static audit of the web layer. No network, no database: everything here is
// decided by reading the files in this repository.
//
// Each check exists because the same mistake was made at least once, and a
// human would not catch it on the next edit. A dead reference or a value written
// into two places does not fail a build, does not throw, and does not show up in
// the browser; it just quietly stops working weeks later, on the one page nobody
// opened. Turning it into a FAIL is the cheapest fix available.
//
//   npm run audit
//   node scripts/audit-web.mjs --root <thu-muc>   (dùng cho thư mục đã build)
//
// Exit code is non-zero when anything is wrong, so it can gate a deploy.
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootFlag = process.argv.indexOf("--root");
const root = rootFlag > -1
  ? path.resolve(process.argv[rootFlag + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
const env = (key) => (process.env[key] || "").trim();

const findings = [];
const fail = (check, file, detail) => findings.push({ check, file, detail });
const read = (relative) => readFile(path.join(root, relative), "utf8");

const publicDir = path.join(root, "public");
const htmlFiles = (await readdir(publicDir)).filter((name) => name.endsWith(".html")).sort();
const scriptFiles = (await readdir(publicDir)).filter((name) => name.endsWith(".js")).sort();
const indexHtml = await read(path.join("public", "index.html"));
const storefrontSource = await read(path.join("public", "app.js"));
const serverSource = await read(path.join("src", "app.js"));
const pagesSource = await read(path.join("src", "pages.js"));
const i18nSource = await read(path.join("public", "i18n.js"));

// ---------------------------------------------------------------------------
// 1. A link or an asset pointing at a file that is not there.
//    /logo.svg was named as the Organization logo on every product page while
//    only favicon.svg existed. Nothing complained: the page rendered, Google
//    just recorded a 404 for the brand's logo.
// ---------------------------------------------------------------------------
// Paths the server answers itself, with no file behind them.
//
// This list has to grow with the server, and that is the point of writing it down
// rather than loosening the check: a route added without a line here is a failing
// build, not a silently accepted 404. /llms.txt, /feed.json and the English
// product path were all missing here when they were first written, and each one
// was caught by the same check that has been catching bad links all along.
const dynamicRoute = /^(?:\/$|\/en(?:\/product\/[^/]+)?$|\/product\/[^/]+$|\/order\/[^/]+$|\/og\/[^/]+$|\/robots\.txt$|\/sitemap\.xml$|\/llms\.txt$|\/feed\.json$|\/api\/|\/admin(?:\.html)?$|\/paypal-return(?:\.html)?$|\/lookup$|\/google[0-9a-z]+\.html$|\/ms[0-9a-z]+\.txt$|\/[0-9a-z-]{8,128}\.txt$)/;
// Pages that are entry points rather than link targets: the buyer reaches them
// from an email or a PayPal redirect, and robots.txt deliberately keeps crawlers
// away from all three.
const entryPages = new Set(["order.html", "paypal-return.html", "admin.html", "lookup.html", "404.html"]);

const isRealTarget = (href) => {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return true;
  const parts = clean.replace(/^\//, "").split("/");
  const candidates = clean.endsWith("/")
    ? [path.join(clean, "index.html")]
    : [clean, `${clean}.html`, path.join(...parts, "index.html")];
  return candidates.some((item) => existsSync(path.join(publicDir, item)));
};

for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const match of source.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
    const href = match[1];
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    if (isRealTarget(href) || dynamicRoute.test(href)) continue;
    fail("link gãy", `public/${name}`, `"${href}" không có file tương ứng trong public/`);
  }
}
// The HTML the server renders is held to the same rule as a file on disk.
for (const match of pagesSource.matchAll(/(?:absolute|LOGO_PATH\s*=)\(\s*"(\/[^"]*)"/g)) {
  const href = match[1];
  if (href.includes(":") || isRealTarget(href) || dynamicRoute.test(href)) continue;
  fail("link gãy", "src/pages.js", `absolute("${href}") trỏ tới file không có trong public/`);
}

// ---------------------------------------------------------------------------
// 2. The same Express route registered twice.
//    Express answers with the first registration, so a second, better route is
//    dead code that reads as if it works.
// ---------------------------------------------------------------------------
const routeTally = new Map();
for (const match of serverSource.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)) {
  const route = `${match[1].toUpperCase()} ${match[2]}`;
  routeTally.set(route, (routeTally.get(route) || 0) + 1);
}
for (const [route, count] of routeTally) {
  if (count > 1) fail("route trùng", "src/app.js", `${route} đăng ký ${count} lần, chỉ route đầu chạy`);
}

// ---------------------------------------------------------------------------
// 3. A translation key nobody reads, or a language missing one.
//    i18n.js holds every customer-facing string. A key nothing renders is copy
//    that was renamed once and left behind; the two languages drift apart
//    silently precisely because both files still agree with each other.
// ---------------------------------------------------------------------------
const keysOf = (section) => new Set([...section.matchAll(/'([\w.]+)':/g)].map((m) => m[1]));
const viKeys = keysOf(i18nSource.slice(i18nSource.indexOf("vi: {"), i18nSource.indexOf("en: {")));
const enKeys = keysOf(i18nSource.slice(i18nSource.indexOf("en: {")));
for (const key of viKeys) if (!enKeys.has(key)) fail("thiếu bản dịch", "public/i18n.js", `"${key}" có tiếng Việt, thiếu tiếng Anh`);
for (const key of enKeys) if (!viKeys.has(key)) fail("thiếu bản dịch", "public/i18n.js", `"${key}" có tiếng Anh, thiếu tiếng Việt`);

// i18n.js is excluded from the page scripts below: its own source is the
// dictionary, so every key appears in it as a literal and the check would pass
// itself. What the file does with those keys is still real usage though — the
// status map and the two labels for the switch button both live there — so the
// dictionary tables are stripped and the rest of the file is scanned.
const pageScriptSources = await Promise.all(scriptFiles.filter((name) => name !== "i18n.js").map((name) => read(path.join("public", name))));
// Everything after the dictionary closes is real code that reads those keys: the
// status map, the switch button labels, the download format. A key named only in
// the dictionary is dead copy; a key named in the code beside it is not.
const dictionaryCloses = i18nSource.indexOf("};", i18nSource.indexOf("en: {"));
const i18nCode = i18nSource.slice(dictionaryCloses > 0 ? dictionaryCloses : 0);
const htmlSources = await Promise.all(htmlFiles.map((name) => read(path.join("public", name))));
const allHtml = htmlSources.join("\n");
const usedKeys = new Set([
  // data-i18n holds the key itself; data-i18n-attr holds "attribute:key" pairs.
  // Every page is scanned, not just the homepage: the recovery and PayPal pages
  // carry their own keys, and reading only index.html reported them all as dead.
  ...[...allHtml.matchAll(/\bdata-i18n="([^"]+)"/g)].map((m) => m[1]),
  ...[...allHtml.matchAll(/\bdata-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((pair) => pair.split(":")[1]?.trim()).filter(Boolean)),
  ...pageScriptSources.flatMap((source) => [...source.matchAll(/'([a-z][\w]*(?:\.[\w]+)+)'/g)].map((m) => m[1])),
  // What i18n.js itself reads: the status map, the switch button labels, the
  // download format. A key named only in the dictionary is dead; a key named in
  // the code next to it is not.
  ...[...i18nCode.matchAll(/'([\w.]+)'/g)].map((m) => m[1]),
]);
const orphans = [...viKeys].filter((key) => !usedKeys.has(key)).sort();
if (orphans.length) fail("khoá i18n mồ côi", "public/i18n.js", `${orphans.length} khoá không nơi nào dùng: ${orphans.join(", ")}`);

// ---------------------------------------------------------------------------
// 4. A value that belongs in config and is also written into a file.
//    The support address lives in .env, in the mail templates and in three
//    static pages. Change it in one place and the others keep sending buyers to
//    an address nobody reads.
// ---------------------------------------------------------------------------
// Read the values the audit compares against straight out of the environment,
// with no fallback.
//
// The fallback used to be the shop's own domain and support address. That is the
// one thing this check must never invent: with APP_URL unset it compared the
// files against a constant, found the constant in index.html's own JSON-LD, and
// passed. The mechanism reported itself healthy precisely when it was not
// configured. Now a missing value fails, loudly, naming itself.
const appUrl = env("APP_URL");
const supportEmail = (env("SUPPORT_EMAIL") || "").toLowerCase();
if (!appUrl) fail("cau hinh thieu", "process.env", "APP_URL chưa được đặt — audit không thể biết domain nào là chính");
if (!supportEmail) fail("cau hinh thieu", "process.env", "SUPPORT_EMAIL chưa được đặt — audit không thể biết địa chỉ hỗ trợ nào là chính");
const appHost = appUrl ? new URL(appUrl).hostname.toLowerCase() : "";
const thirdParty = new Set(["www.w3.org", "schema.org", "www.sitemaps.org", "localhost", "img.vietqr.io", "fonts.googleapis.com", "fonts.gstatic.com", "resend.com", "supabase.com", "supabase.co", "paypal.com", "google.com", "cloudflare.com", "render.com", "ipapi.co", "ipwho.is", "er-api.com", "exchangerate-api.com", "indexnow.org"]);
// i18n.js is scanned too: brand.supportEmail is the configured default the pages
// fall back to, so letting it drift away from .env would mean an empty mailto on
// exactly the page a paying customer is reading.
//
// Tests are scanned for the production domain only, and that rule earned its place
// by failing on the first run. A test asserting on a literal shop address looks
// correct on the machine it was written on and fails everywhere else: CI sets
// APP_URL and SUPPORT_EMAIL to fixture values on purpose, so two tests failed from
// the first run and would have failed on every push from then on. A test that only
// passes with one .env is a test that does not run.
//
// The other domain and email rules stay off here. A test legitimately names a
// loopback address and a fixture mailbox, and flagging those would only teach
// people to ignore the audit.
const emailBearing = [...htmlFiles, ...scriptFiles].map((n) => path.join("public", n)).concat([path.join("src", "pages.js"), path.join("public", "i18n.js")]);
const testDir = path.join(root, "test");
const testFiles = existsSync(testDir) ? (await readdir(testDir)).filter((name) => name.endsWith(".js")) : [];
for (const name of testFiles) {
  // This file exists to run the audit against a fixture APP_URL, so it necessarily
  // contains a domain that the audit would flag. Skipping it by name is the only
  // honest option: a pattern meant to recognise "this is a fixture" would eventually
  // match a real hardcode written in the same shape.
  if (name === "audit.test.js") continue;
  const relative = path.join("test", name);
  const source = await read(relative);
  for (const match of source.matchAll(new RegExp(`(?<![/.\\w-])${appHost.replace(/\./g, "\\.")}(?![\\w-])`, "gi"))) {
    const line = source.slice(0, match.index).split("\n").length;
    fail("domain gõ tay", `${relative}:${line}`, `${match[0]} — APP_URL là ${appUrl}. Test phai doc tu process.env.APP_URL, khong ghi cung domain.`);
  }
}

for (const relative of emailBearing) {
  const source = await read(relative);
  for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    const host = match[1].toLowerCase();
    // The site's own origin is the one value that must never be written into a
    // file: it decides the canonical URL, which is what tells a search engine
    // which of two copies is the real page. index.html writes {{site}} and the
    // server fills it from APP_URL, so a domain change is one env var.
    if (host === appHost || host === `www.${appHost}`) {
      fail("domain gõ tay", relative, `https://${host} viết thẳng vào file — dùng {{site}} (index.html) hoặc site() (src/pages.js)`);
      continue;
    }
    if (thirdParty.has(host)) continue;
    if (host.endsWith(".supabase.co") || host.endsWith(".r2.cloudflarestorage.com")) continue;
    fail("domain gõ tay", relative, `https://${host} — APP_URL là ${appUrl}`);
  }
  // The same domain written without a scheme. The scan above needs "https://" to
  // find a host, so prose like "áp dụng cho mọi giao dịch tại sonvudev.com" passed
  // straight through — and that is exactly the string a legal page shows a buyer
  // deciding whether the terms they are reading are the ones that apply.
  if (appHost) {
    for (const match of source.matchAll(new RegExp(`(?<![/.\\w-])${appHost.replace(/\./g, "\\.")}(?![\\w-])`, "gi"))) {
      const line = source.slice(0, match.index).split("\n").length;
      fail("domain gõ tay", `${relative}:${line}`, `${match[0]} — APP_URL là ${appUrl}`);
    }
  }
  for (const match of source.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) {
    const address = match[0].toLowerCase();
    if (address === supportEmail) continue;
    if (/@(example|sonvudev|localhost|test|your-paypal)/.test(address)) continue;
    fail("email gõ tay", relative, `${match[0]} — SUPPORT_EMAIL là ${supportEmail}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Structured data that points at a page robots.txt forbids.
//    SearchAction aimed at /lookup, a page the store deliberately hides: the
//    markup told Google to read a page it had been told to skip. Anything a
//    crawler is told to read has to be a page it is allowed to read.
// ---------------------------------------------------------------------------
// The Disallow lines are written as array entries, so the capture also picks up
// the closing quote and comma. Left in, every entry reads as "/lookup\"," and
// matches nothing, which is how this check would pass while broken.
const blocked = new Set([...serverSource.matchAll(/Disallow:\s*"?([^"\s,]+)"?/g)].map((m) => m[1].replace(/\/$/, "")));
for (const match of pagesSource.matchAll(/"(?:urlTemplate|item|url)"\s*:\s*`?\$\{?site\(\)\}?(\/[^"`]*)/g)) {
  // Only the path decides whether a crawler may read it. A target with a query
  // string still describes the page behind it, and that page is what matters.
  const target = match[1].split("?")[0].replace(/\/$/, "");
  if (blocked.has(target)) fail("schema chặn", "src/pages.js", `dữ liệu có cấu trúc trỏ tới ${target} mà robots.txt chặn`);
}

// A token the server never substitutes is a value the page prints verbatim. The
// {{support}}, {{site}}, {{year}} and {{paymentWindowHours}} tokens each cover
// their own pages; a new one added to a template and never wired up is invisible
// until a buyer reads "{{legalEntity}}" in the middle of the terms.
const wiredTokens = ["site", "support", "year", "paymentWindowHours", "legalEntity", "jsonLd"];
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const match of source.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
    if (wiredTokens.includes(match[1])) continue;
    fail("token chua noi", `public/${name}`, `{{${match[1]}}} không có chỗ nào trong renderPage điền vào`);
  }
}

// ---------------------------------------------------------------------------
// 6. A page in public/ that nothing links to.
//    An orphaned page is one the owner believes is live, that no visitor reaches
//    from anywhere, and that a crawler may still find and index.
// ---------------------------------------------------------------------------

// 6a. A data-i18n element with no text in it.
//
// The storefront fills these from the dictionary at runtime, so an element left
// empty is fine for a person with JavaScript and empty for everyone else: a
// crawler, a link-preview bot, an assistant fetching the HTML, or a reader who
// turned scripting off. The text has to be sitting in the markup already, which is
// what scripts/fill-static-text.mjs writes.
//
// This check is what turns that one-off script into a gate: it can be run once,
// and the build then refuses to let the drift come back the next time someone
// edits i18n.js and forgets the HTML.
for (const match of indexHtml.matchAll(/<(?:span|p|h1|h2|h3|a|button|summary|li|div)[^>]*\bdata-i18n="([\w.]+)"[^>]*>\s*</g)) {
  fail("chữ rỗng", "public/index.html", `data-i18n="${match[1]}" không có chữ trong HTML — chạy npm run i18n:fill`);
}

const reachable = new Set();
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const match of source.matchAll(/href="\/([^"#?]*)/g)) {
    const target = match[1].replace(/\/$/, "");
    if (target) reachable.add(target.endsWith(".html") ? target : `${target}.html`);
  }
}
for (const name of htmlFiles) {
  if (name === "index.html" || entryPages.has(name)) continue;
  if (!reachable.has(name)) fail("trang mồ côi", `public/${name}`, `/${name.replace(/\.html$/, "")} không có trang nào trỏ tới`);
}

// ---------------------------------------------------------------------------
// 7. Two scripts on one page declaring the same top-level name.
//    A classic <script> with `let x` or `const x` puts x in the global lexical
//    scope, so a second script declaring x is a SyntaxError and that script never
//    runs at all. order.js and i18n.js both declared `current`, which left the
//    order page blank: it renders an empty shell with no error on screen, and it
//    is the page a buyer reaches after paying and losing their session. Both
//    files passed their own syntax check and their own tests, because each was
//    valid on its own — only loading them together breaks.
// ---------------------------------------------------------------------------
const declarationsOf = (source) => {
  const names = [];
  for (const match of source.matchAll(/^(?:let|const)\s+([^=;]+)=/gm)) {
    // One statement can declare several names; only the leading ones matter,
    // since the rest need their own destructuring pass.
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/[\s=:[({]/)[0];
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
};
for (const name of htmlFiles) {
  const html = await read(path.join("public", name));
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1].replace(/^\.?\//, ""));
  const owners = new Map();
  for (const script of scripts) {
    const file = path.join(publicDir, script);
    if (!existsSync(file)) continue;
    for (const declared of declarationsOf(await read(path.join("public", script)))) {
      if (!owners.has(declared)) owners.set(declared, []);
      owners.get(declared).push(script);
    }
  }
  for (const [declared, files] of owners) {
    if (files.length > 1) {
      fail("trùng tên toàn cục", `public/${name}`, `"${declared}" được khai báo ở cả ${files.join(" và ")} — trang sẽ không chạy`);
    }
  }
}

// ---------------------------------------------------------------------------
const groups = 7;
for (const item of findings) console.error(`FAIL  ${item.check.padEnd(18)} ${item.file}: ${item.detail}`);
console.log(`\n[audit] ${groups} nhom kiem tra, ${findings.length} van de.`);
if (!findings.length) console.log("[audit] PASS: khong co domain ghi tay, route trung, link gay hay khoa i18n mo coi.");
else process.exitCode = 1;
