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
const dynamicRoute = /^(?:\/$|\/en(?:\/product\/[^/]+)?$|\/product\/[^/]+$|\/order\/[^/]+$|\/og\/[^/]+$|\/robots\.txt$|\/sitemap\.xml$|\/llms\.txt$|\/feed\.json$|\/api\/|\/admin(?:\.js|\.html)?$|\/paypal-return(?:\.html)?$|\/lookup(?:\.html)?$|\/google[0-9a-z]+\.html$|\/ms[0-9a-z]+\.txt$|\/[0-9a-z-]{8,128}\.txt$)/;
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

// ---------------------------------------------------------------------------
// 3b. A key the server hands to the browser by name.
//
//     "Used" is not only "named in a page script". src/payments.js sends the
//     checkout form a labelKey and a hintKey, and the form resolves them against
//     the dictionary at render time — eleven working keys, not one character of
//     which appears in public/. Reading only the pages reported every one of them
//     as dead, which is how a correct change gets "fixed" back into a hardcode.
//
//     So the modules that produce content for the browser are read too. These two
//     answer with keys and nothing else: the other modules either answer with
//     errors, which the caller decides how to present, or render the page itself,
//     in a locale of their own.
// ---------------------------------------------------------------------------
const keyProducers = [];
for (const name of ["payments.js", "reviews.js"]) {
  const file = path.join("src", name);
  if (existsSync(file)) keyProducers.push([`src/${name}`, await read(file)]);
}
for (const [, source] of keyProducers) {
  // Both quote styles: src/payments.js is written in double quotes like the rest
  // of src/, and a single-quoted pattern reported every payment key as dead.
  for (const match of source.matchAll(/'([a-z][\w]*(?:\.[\w]+)+)'|"([a-z][\w]*(?:\.[\w]+)+)"/g)) {
    usedKeys.add(match[1] || match[2]);
  }
}

const orphans = [...viKeys].filter((key) => !usedKeys.has(key)).sort();
if (orphans.length) fail("khoá i18n mồ côi", "public/i18n.js", `${orphans.length} khoá không nơi nào dùng: ${orphans.join(", ")}`);

// ---------------------------------------------------------------------------
// 3c. The same key written twice in one dictionary.
//
//     Object literals accept it: the last one wins, silently. vi had
//     'nav.refund' twice, one of them already superseded, so correcting it changed
//     nothing and the mistake stayed invisible to every other check — including the
//     ones that read every key to decide whether it is used. Two halves of one file
//     disagreeing with each other is the same failure as a key missing from one
//     language, and it gets the same treatment.
// ---------------------------------------------------------------------------
// Reads the object literal that starts at a marker, by counting braces and
// ignoring anything inside a string. The obvious version of this — from
// "vi: {" to the next "};" — runs straight past the end of the vi block, because
// a dictionary is written `{ vi: {…}, en: {…} };` and the first thing that looks
// like its end belongs to the whole DICT two hundred keys later. Every key then
// appeared to be declared twice, and the check reported the entire file.
const objectLiteralAt = (source, marker) => {
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) return "";
  const open = source.indexOf("{", markerAt);
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") { i += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && (depth -= 1) === 0) return source.slice(open, i + 1);
  }
  return "";
};

for (const [name, label] of [["vi", "tiếng Việt"], ["en", "tiếng Anh"]]) {
  const block = objectLiteralAt(i18nSource, `${name}: {`);
  if (!block) {
    fail("khoá i18n trùng", "public/i18n.js", `không đọc được khối ${label} — có lẽ tên ${name}: { đã đổi`);
    continue;
  }
  const seen = new Set();
  for (const match of block.matchAll(/^ {4}'([\w.]+)':/gm)) {
    if (seen.has(match[1])) {
      fail("khoá i18n trùng", "public/i18n.js", `khoá "${match[1]}" khai báo hai lần trong ${label} — bản sau âm thầm ghi đè bản trước`);
    }
    seen.add(match[1]);
  }
}

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
if (!appUrl) fail("cấu hình thiếu", "process.env", "APP_URL chưa được đặt — audit không thể biết domain nào là chính");
if (!supportEmail) fail("cấu hình thiếu", "process.env", "SUPPORT_EMAIL chưa được đặt — audit không thể biết địa chỉ hỗ trợ nào là chính");
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
  // With no APP_URL there is no host to look for, and an empty pattern matches at
  // every position in every file. The missing-configuration failure is already
  // reported above; adding one finding per character on top of it buried the report
  // in output until the process was killed for writing too much, which is a much
  // worse way to be told the environment is unset.
  if (!appHost) continue;
  const relative = path.join("test", name);
  const source = await read(relative);
  for (const match of source.matchAll(new RegExp(`(?<![/.\\w-])${appHost.replace(/\./g, "\\.")}(?![\\w-])`, "gi"))) {
    const line = source.slice(0, match.index).split("\n").length;
    fail("domain gõ tay", `${relative}:${line}`, `${match[0]} — APP_URL là ${appUrl}. Test phải đọc từ process.env.APP_URL, không ghi cứng domain.`);
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
// 4b. The site's own host written into a file the audit never looked at.
//
//     Section 4 above reads public/, src/pages.js and i18n.js. deploy/ and
//     scripts/ were never in the list, so Caddyfile could pin the reverse proxy to
//     one domain and deploy.sh to one install root, and publish-product.mjs could
//     tell the operator to go and check one specific address at the end of a
//     release. Every gate was green and none of those files had ever been
//     examined.
//
//     Only this project's own host is checked here, not arbitrary hosts: a script
//     legitimately talks to api.render.com and supabase.com, and flagging those
//     would only teach people to ignore the audit. What must never be written down
//     is the value APP_URL already holds.
// ---------------------------------------------------------------------------
const infraFiles = [];
for (const [dir, filter] of [["deploy", () => true], ["scripts", (name) => /\.(mjs|js|sh|ps1)$/.test(name)]]) {
  const full = path.join(root, dir);
  if (!existsSync(full)) continue;
  for (const name of await readdir(full)) {
    if (filter(name)) infraFiles.push(path.join(dir, name));
  }
}
for (const relative of infraFiles) {
  // This file exists to name the mistake, so it necessarily quotes the address
  // that mistake takes. Same reasoning as skipping audit.test.js above. Compared
  // on the file name: path.join uses a backslash on Windows, and "audit-web.mjs"
  // never equals "scripts\audit-web.mjs".
  if (path.basename(relative) === "audit-web.mjs") continue;
  const source = await read(relative);
  if (!appHost) continue;
  for (const match of source.matchAll(new RegExp(`(?<![/.\\w-])${appHost.replace(/\./g, "\\.")}(?![\\w-])`, "gi"))) {
    const line = source.slice(0, match.index).split("\n").length;
    fail("domain gõ tay", `${relative}:${line}`, `${match[0]} — APP_URL là ${appUrl}. Dùng biến môi trường thay vì ghi tên miền.`);
  }
}

const accented = (value) => /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(value);
// ---------------------------------------------------------------------------
// 4c. Content the storefront prints, written in a language the reader may not
//     speak.
//
//     /api/checkout/options used to answer with Vietnamese labels — "Chuyển khoản
//     ngân hàng / Quét mã QR", "Hỗ trợ MoMo, ZaloPay và quét mã VietQR" — and the
//     checkout form printed them straight into the markup. A visitor who switched
//     the site to English chose a payment method labelled in the language they had
//     chosen not to read, on the one screen where the money is.
//
//     The server now names a key and the browser resolves it, so no sentence can
//     survive in this file by accident. src/pages.js is deliberately exempt: it
//     renders the page itself and keeps one table per locale, which is the only
//     place a sentence is allowed to belong to one language.
// ---------------------------------------------------------------------------
for (const name of ["payments.js"]) {
  const file = path.join("src", name);
  if (!existsSync(file)) continue;
  const source = await read(file);
  for (const match of source.matchAll(/(['"`])((?:[^'"`\\]|\\.)*?)\1/g)) {
    const value = match[2];
    if (value.length > 2 && accented(value)) {
      const line = source.slice(0, match.index).split("\n").length;
      fail("tiếng Việt ở phía máy chủ", `src/${name}:${line}`, `"${value}" — nội dung hiển thị phải đến từ từ điển, máy chủ chỉ gửi khoá`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4d. The same identity declared twice on one page.
//
//     og:site_name, og:brand and twitter:site are added to every rendered page by
//     brandMeta() from BRAND_NAME. index.html also typed its own, with the brand
//     written into og:site_name, og:title, og:image:alt and twitter:title — so a
//     page carried two og:site_name tags with no way to say which one a scraper
//     would believe, and changing BRAND_NAME left the homepage announcing the old
//     shop on every share card while the product pages announced the new one.
//
//     "Declared once" is the property worth checking. Whether a page may add one of
//     its own is a question about the brand, and the audit cannot answer that.
// ---------------------------------------------------------------------------
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const property of ["og:site_name", "og:brand"]) {
    const declared = [...source.matchAll(new RegExp(`property="${property}"`, "g"))];
    if (declared.length > 1) {
      fail("thương hiệu khai báo hai lần", `public/${name}`, `${property} xuất hiện ${declared.length} lần — để brandMeta() lo, đừng gõ thêm vào template`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4e. A language switch the page cannot honour.
//
//     index.html offers EN and can deliver it. The legal pages and the 404 do not
//     load i18n.js at all, so they cannot — and none of them pretend to. That is a
//     known, counted gap rather than an accident, but the failure mode is a page
//     that grows a .lang-toggle while its prose is still one language: the button
//     appears, is translated by the dictionary, and flips nothing.
//
//     So the rule is only about the contradiction, not about the gap. metrics.mjs
//     counts how many pages carry the dictionary, and its direction is "up", so the
//     gap is visible as a number that has to be moved on purpose.
// ---------------------------------------------------------------------------
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  const hasToggle = /data-lang-toggle/.test(source);
  const hasDictionary = /src="i18n\.js"/.test(source);
  if (hasToggle && !hasDictionary) {
    fail("nút đổi ngữ không có từ điển", `public/${name}`, `có data-lang-toggle nhưng không nạp i18n.js — nút sẽ không làm gì`);
  }
  if (!hasToggle && hasDictionary && !name.endsWith(".html")) {
    fail("thừa nhiệu", `public/${name}`, `nạp từ điển mà không có nút đổi ngôn ngữ`);
  }
}

// ---------------------------------------------------------------------------
// 4f. A placeholder the renderer does not know how to fill.
//
//     A product description may contain {{founder}}, and it is filled on the way out
//     from BRAND_FOUNDER_NAME. That is the whole reason it is a placeholder: the name
//     was typed by hand once, into one product's text, in a spelling the owner does
//     not use — "Vũng Trọng Sơn" where the name is "Vũ Trung Sơn". Nothing could
//     compare the two, because every other mention of the owner on the site read
//     from configuration and that one read from a text field.
//
//     A placeholder the renderer does not recognise is the failure this design has
//     instead, and a worse-looking one: the buyer reads the braces. So an unknown
//     {{token}} in a template is a FAIL rather than something that quietly ships.
//
//     Scoped to the templates, which is where a placeholder can reach a customer.
//     The audit's own source quotes several of them in the explanation of this very
//     check, and a check that fires on the description of the bug it is looking for
//     is a check that gets switched off.
const KNOWN_TOKENS = new Set([
  "site", "support", "year", "jsonLd", "legalEntity", "paymentWindowHours",
  "reviewMinLength", "reviewMaxLength", "brandName", "brand",
  // Filled by fillCopy() on the way out, from BRAND_FOUNDER_NAME and BRAND_NAME,
  // so a person's name in product copy cannot be misspelled independently of it.
  "founder",
]);
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const token of source.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
    if (!KNOWN_TOKENS.has(token[1])) {
      fail("placeholder lạ", `public/${name}`, `{{${token[1]}}} không nằm trong danh sách token mà renderPage biết điền`);
    }
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

// ---------------------------------------------------------------------------
// 5b. Vietnamese written without its diacritics, in text a person reads.
//
//     Two buttons in the admin panel read "Tai them don hang" and "Da xem het don
//     hang" for as long as the panel has existed. Nothing here would have caught it:
//     it parses, it renders, it has the right shape, and every test that touched the
//     panel asserted on structure rather than on what it says.
//
//     The first attempt compared single words and was hopeless: "thanh", "hay",
//     "dung", "thay", "ngay" and "trong" are all real Vietnamese words with the
//     diacritics dropped, and English code comments are full of "that", "than" and
//     "them", which are the same as "thất" and "thận" without marks. Fifty-three
//     findings, none of them the bug.
//
//     So this matches phrases of two or three words instead. "Tai them don hang"
//     cannot be English, cannot be a coincidence, and is unmistakably the
//     unaccented form of a phrase spelled correctly somewhere else in the project.
//     The dictionary is still built from the project itself, so it has nothing to
//     tune and cannot fire on a phrase the project has never written.
// ---------------------------------------------------------------------------
const stripDiacritics = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PHRASES = new Map();
for (const source of [i18nSource, ...htmlSources, ...pageScriptSources, await read(path.join("src", "pages.js")), await read(path.join("src", "app.js"))]) {
  const words = source.replace(/<[^>]+>/g, " ").match(/[\wÀ-ỹĐđ]{2,}/g) || [];
  for (let i = 0; i < words.length; i += 1) {
    for (const size of [3, 2]) {
      if (i + size > words.length) continue;
      const phrase = words.slice(i, i + size);
      // Every word has to be accented, or the phrase is already ASCII somewhere
      // else and the entry would fire on perfectly correct text.
      if (!phrase.every(accented)) continue;
      PHRASES.set(stripDiacritics(phrase.join(" ")), phrase.join(" "));
    }
  }
}
const suspects = [...PHRASES.keys()].sort((a, b) => b.length - a.length);
// i18n.js is excluded: its own source is the dictionary, so every correctly spelled
// phrase in the project appears in it in ASCII form as the key.
const customerFacing = [...htmlFiles, ...scriptFiles.filter((name) => name !== "i18n.js")].map((name) => path.join("public", name));
// Comments are stripped first, and only comments: they are English, and a save
// handler documented in prose is full of "that" and "them". Strings are kept,
// because that is where the customer-facing text lives.
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
for (const relative of customerFacing) {
  const raw = await read(relative);
  const text = stripComments(relative.endsWith(".js")
    ? raw
    : raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " "));
  for (const phrase of suspects) {
    const match = new RegExp(`(?<![\\wÀ-ỹ])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\wÀ-ỹ])`, "i").exec(text);
    if (match) fail("tiếng Việt không dấu", relative, `"${match[0]}" — viết đúng là "${PHRASES.get(match[0].toLowerCase())}"`);
  }
}

// The same rule for the text a person reads when something is wrong rather than
// when they buy something: script output and test names.
//
// Those two were never scanned, so the missing diacritics accumulated in exactly
// the places that get read under pressure — an unaccented "Khong tim thay san pham",
// an unaccented "phai tra ve cung mot don", an unaccented "trang sau khac trang
// truoc". Unaccented Vietnamese is not illegible, which is why it survived: it
// reads as written, just wrong, and only someone who already knows the correct
// spelling notices. A customer on the storefront would have spotted it at once.
//
// Longer phrases only, and comments are stripped as they are above. Two Vietnamese
// words collide with ordinary English often enough to be useless ("on it", "so the"),
// and this repository writes its code comments in English on purpose — the Vietnamese
// that appears in a comment is a quotation of a message that was wrong, and a check
// that fires on the description of a fixed bug is a check people disable.
//
// Strings and test titles are not ambiguous: if three or more accented words appear
// bare together, they are a sentence in this language.
const operatorFacing = [];
for (const dir of ["scripts", "test", "deploy"]) {
  const full = path.join(root, dir);
  if (!existsSync(full)) continue;
  for (const name of await readdir(full)) {
    if (/\.(mjs|js|sh|service|example)$/.test(name) || name === "Caddyfile") operatorFacing.push(path.join(dir, name));
  }
}
if (existsSync(path.join(root, ".env.example"))) operatorFacing.push(".env.example");
const longSuspects = [...PHRASES.entries()].filter(([bare]) => bare.split(" ").length >= 3).map(([bare]) => bare).sort((a, b) => b.length - a.length);
for (const relative of operatorFacing) {
  // This test exists to make the check fail, so it has to contain the mistake. Same
  // reasoning as skipping this file's own domain scan above, and the same cost: a
  // deliberate hole in one file, for the file that proves the rule works.
  if (path.basename(relative) === "audit.test.js") continue;
  const text = stripComments(await read(relative));
  for (const phrase of longSuspects) {
    const match = new RegExp(`(?<![\\wÀ-ỹ])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\wÀ-ỹ])`, "i").exec(text);
    if (match) fail("tiếng Việt không dấu", relative, `"${match[0]}" — viết đúng là "${PHRASES.get(match[0].toLowerCase())}"`);
  }
}

// A token the server never substitutes is a value the page prints verbatim, and a
// token on a page the renderer never sees is the same thing for a second reason.
// Both used to hide behind one hand-written list of token *names*, which answered
// the wrong question twice over: it could not tell that {{reviewMax}} had no
// substitute anywhere, and it could not tell that {{support}} had one and was still
// being printed raw — because lookup.html was never routed through renderPage at
// all. /lookup served the literal "{{support}}" as the support address on the
// recovery page, and /404.html printed "© {{year}}". Four gates, all green.
//
// So the names are read out of renderPage instead of being written down, and a
// file carrying any token has to be named in the renderer at all. If renderPage
// ever moves, the slice below is empty and every token fails loudly rather than
// silently passing again.
const renderStart = serverSource.indexOf("async function renderPage");
const renderBody = serverSource.slice(renderStart, serverSource.indexOf("const sendPage", renderStart));
const wiredTokens = new Set([...renderBody.matchAll(/replaceAll\(\s*"\{\{\s*([a-zA-Z]+)\s*\}\}"/g)].map((m) => m[1]));
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const match of source.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
    if (!wiredTokens.has(match[1])) {
      fail("token chưa nối", `public/${name}`, `{{${match[1]}}} không có chỗ nào trong renderPage điền vào`);
    }
    if (!serverSource.includes(`"${name}"`)) {
      fail("trang chưa render", `public/${name}`, `có token {{${match[1]}}} nhưng tên file không xuất hiện trong src/app.js — express.static sẽ serve file thô và token lọt thẳng ra trang`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5d. An hreflang pointing at a URL the site does not answer.
//
//     index.html declared hreflang="en" href="{{site}}/en" for as long as the
//     language switch existed. There is no /en route and never was: the English
//     pages are /en/product/<slug>, rendered by pages.js. So the homepage told a
//     crawler the English version of itself lived at a 404.
//
//     This audit could not catch it, because the hand-written dynamicRoute list in
//     section 1 included /en — it asserted the existence of the very route it was
//     meant to check. The routes are read out of src/app.js instead, so the check
//     can no longer pass by believing something the server does not register.
// ---------------------------------------------------------------------------
const routeMatches = [...serverSource.matchAll(/app\.(?:get|post|patch|put|delete)\(\s*(?:"([^"]*)"|\[([^\]]*)\])/g)];
const routePaths = routeMatches.flatMap((m) => (m[2] ? [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : [m[1]])).filter(Boolean);
const toRouteRegex = (route) => new RegExp(`^${route.split("/").map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\/")}/?$`);
const answers = (target) => isRealTarget(target) || routePaths.some((route) => toRouteRegex(route).test(target));

for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const match of source.matchAll(/hreflang="([^"]+)"\s+href="\{\{site\}\}([^"]+)"/g)) {
    if (!answers(match[2])) {
      fail("hreflang chết", `public/${name}`, `hreflang="${match[1]}" trỏ tới ${match[2]} mà máy chủ không có route nào trả lời`);
    }
  }
}
// The product renderer picks its own two shapes, one per language, and hangs the
// alternate links off them. Neither is written in a template, so it is asserted
// against the route list here instead of being read out of a tag.
for (const shape of ["/product/:slug", "/en/product/:slug"]) {
  if (!routePaths.includes(shape)) {
    fail("hreflang chết", "src/pages.js", `productUrl() sinh ra ${shape} nhưng src/app.js không đăng ký route đó`);
  }
}

// ---------------------------------------------------------------------------
// 6. A page in public/ that nothing links to.

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
// Every family of defect this file knows how to catch. Kept as a number because it
// is the number a reader checks: a project that discovers a new way to break
// itself and cannot make the mechanism fail has not fixed anything, and "7" is
// easy to notice go stale and "several" is not.
//
//  1 link or asset with no file behind it
//  2 the same route registered twice
//  3 an i18n key in one language and missing in the other
//  3b an i18n key no page and no server module can reach
//  3c the same key written twice in one dictionary
//  4 a configured value also written into a file
//  4b the site's own host in deploy/ or scripts/
//  4c display content sent in one language
//  4d the same identity declared twice on one page
//  4e a language switch the page cannot honour
//  4f a template placeholder nothing knows how to fill
//  5 structured data pointing at a page robots.txt forbids
//  5b Vietnamese written without its diacritics, in the storefront and in the
//     operator-facing text of scripts/ and test/
//  5c a template token the renderer never fills
//  5d a template the renderer never sees, token or not
//  5e an hreflang pointing at a URL nothing answers
//  6 a page nothing links to
//  7 a phrase from the fallback dictionary inside the dictionary itself
//  8 the same global declared by two scripts on one page
const groups = 17;
for (const item of findings) console.error(`FAIL  ${item.check.padEnd(18)} ${item.file}: ${item.detail}`);
console.log(`\n[audit] ${groups} nhom kiem tra, ${findings.length} van de.`);
if (!findings.length) console.log("[audit] PASS: không có domain gõ tay, route trùng, link gãy, tiếng Việt mất dấu hay khoá i18n mồ côi.");
else process.exitCode = 1;
