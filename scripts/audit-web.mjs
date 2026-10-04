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
import { corsDiff, isFixtureHost } from "./lib/cors.mjs";

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
//     So the modules that produce content for the browser are read too. These
//     answer with keys and nothing else: the other modules either answer with
//     errors, which the caller decides how to present, or render the page itself,
//     in a locale of their own.
//
//     src/app.js joins them, because that changed. It used to answer with a
//     Vietnamese sentence and `error`, which is not translatable, so it was
//     excluded — correctly, at the time. It now answers through src/refuse.js,
//     carrying `code` beside the sentence, and 46 of these keys come from nowhere
//     else in the repository. Listed here or nowhere, this list is what tells the
//     dictionary which of its own entries are live, so a key added to app.js and
//     forgotten here reads as dead copy and gets deleted.
//
//     src/refuse.js is deliberately not in it. That file documents the shape with
//     a worked example — `refuse("api.err.rateLimited", …)` — and a name that
//     appears only in prose is not a key anybody sends. Including it reported
//     thirty-eight phantom usages of a string that does not exist.
const keyProducers = [];
for (const name of ["payments.js", "reviews.js", "app.js"]) {
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
// 3a. The other direction: a key a page asks for that the dictionary does not
//     have.
//
//     Everything above asked whether the dictionary holds something nobody reads.
//     Nothing asked whether what a page reads exists at all, so the failure was
//     invisible in both directions at once.
//
//     It is not a crash. I18N.t falls back to the caller's string, and for
//     markup that fallback is the element's existing textContent — the Vietnamese
//     written into the HTML. So a missing key produces a page that renders
//     correctly in the language it was authored in and silently refuses to switch
//     to any other. public/404.html used `data-i18n="nav.home"` on both of its
//     home links; the dictionary has eleven nav.* keys and that is not one of
//     them, so an English visitor arriving from a broken link got "Về trang chủ"
//     in a language they did not choose, from the page whose entire job is to
//     help a lost visitor get somewhere else.
//
//     The specific page does not matter. The gap did: any data-i18n key with a
//     typo, or a key renamed in the dictionary and not in the pages, produced the
//     same silent bilingual leak.
// ---------------------------------------------------------------------------
const declared = viKeys.size > enKeys.size ? viKeys : enKeys;
const requested = new Set([
  ...[...allHtml.matchAll(/\bdata-i18n="([^"]+)"/g)].map((m) => m[1]),
  ...[...allHtml.matchAll(/\bdata-i18n-attr="([^"]+)"/g)]
    .flatMap((m) => m[1].split(",").map((pair) => pair.split(":")[1]?.trim()).filter(Boolean)),
]);
const undefinedKeys = [...requested].filter((key) => !declared.has(key)).sort();
if (undefinedKeys.length) {
  fail("khoá i18n chưa định nghĩa", "public/*.html",
    `${undefinedKeys.length} khoá trang dùng mà từ điển không có: ${undefinedKeys.join(", ")} — trang sẽ không đổi được ngữ`);
}

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
    // Comments have to be skipped, and this is not a refinement. The loop tracks
    // whether it is inside a string so that a brace inside one does not count,
    // but a `//` comment is not a string — so a single double quote in a comment
    // opened a "string" that ran until the next quote hundreds of lines later,
    // swallowing the real braces and desynchronising the depth count. The
    // consequence is not a missed duplicate key: the parser reads past the end
    // of the block it was asked for, and then reports every key in the file as
    // declared twice. 209 findings, one of them an apostrophe in a Vietnamese
    // comment, and the gate that exists to prevent confusion became the thing
    // producing it.
    if (!quote && char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (!quote && char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
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
// These two are what make the domain and address checks meaningful: without them the
// audit cannot tell the shop's own domain from a third party's, so it would either
// compare against a guess or skip the checks that matter.
//
// That used to be a hard failure, which is right in production and wrong everywhere
// else. A fresh clone has no .env, so `npm run audit` — the first thing anybody runs
// after cloning — failed on two lines about missing configuration, and a person who
// had just proved the suite worked on another machine was told the audit does not.
// The failure said nothing about the code.
//
// So a missing value now skips only what it makes impossible, says which, and lets
// the other groups run. In production APP_URL is set, so nothing is skipped and the
// gate is exactly as strict as before.
//
// The list is printed at the end rather than here, next to the group count. Printing
// it here meant the count on screen was the number known at this line, not the number
// that was skipped — and the R2 CORS check below adds a third reason, so a reader
// comparing the two numbers would have been told three groups ran when four did not.
const skipped = [];
if (!appUrl) skipped.push("domain gõ tay (cần APP_URL)");
if (!supportEmail) skipped.push("địa chỉ hỗ trợ gõ tay (cần SUPPORT_EMAIL)");
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

// ---------------------------------------------------------------------------
// 4bb. The R2 bucket's origin list, which is the one place a browser can be refused.
//
//     cloudflare/r2-cors.json is applied to the bucket by hand and read by nothing.
//     No other check in this repository can see it, and the failure it produces is
//     the single release-publishing action in the shop: public/admin.js asks the
//     server for a presigned URL and then PUTs to *.r2.cloudflarestorage.com from
//     the browser, so a stale AllowedOrigins refuses the upload with a CORS error
//     and nothing else in the project notices — not the build, not /api/health,
//     not check:production.
//
//     So the file is compared against APP_URL by the same function the fix command
//     uses (scripts/lib/cors.mjs), which means the check and the repair cannot
//     disagree about what "correct" is.
//
//     Skipped on a fixture APP_URL, and it says so. CI sets APP_URL to
//     https://ci-fixture.example so that a fresh clone and this machine run the
//     same checks — a value whose host is a reserved .example domain cannot be a
//     shop anybody buys from, so asking whether the committed CORS file matches it
//     would report a false failure on every push. The real comparison happens on a
//     machine with a real .env, and again in check:production before a deploy.
// ---------------------------------------------------------------------------
if (appUrl && isFixtureHost(appUrl)) {
  skipped.push("R2 CORS khớp APP_URL (APP_URL là giá trị giả)");
} else if (appUrl) {
  let corsRules = [];
  let corsReadable = true;
  try {
    corsRules = JSON.parse(await read(path.join("cloudflare", "r2-cors.json")));
  } catch (error) {
    corsReadable = false;
    fail("R2 CORS lệch", "cloudflare/r2-cors.json", `không đọc được: ${error.message}`);
  }
  if (corsReadable) {
    const diff = corsDiff(corsRules, appUrl);
    if (diff.missing.length) {
      fail("R2 CORS lệch", "cloudflare/r2-cors.json",
        `thiếu ${diff.missing.join(", ")} — upload từ trang quản trị sẽ bị CORS chặn. Chạy: npm run r2:cors:write`);
    }
    // An extra origin is a widening of who may upload to the bucket rather than a
    // break, so it is reported with the same fix but not as the same severity.
    if (diff.extra.length) {
      fail("R2 CORS thừa origin", "cloudflare/r2-cors.json",
        `${diff.extra.join(", ")} không do APP_URL sinh ra — ai đó có thể upload vào bucket`);
    }
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
  // The second half of this check was unreachable: the loop is over htmlFiles, so
  // `name.endsWith(".html")` was always true and the branch never ran. The
  // condition it was reaching for is the mirror of the one above — a page that
  // loads the dictionary but offers no way to change language — and it is a real
  // finding, not a style preference: the dictionary applies on load, so such a
  // page translates itself into the reader's stored preference and then offers no
  // control over it. It was dead code written to catch that.
  if (hasDictionary && !hasToggle) {
    fail("thừa nhiệu", `public/${name}`, `nạp từ điển mà không có nút đổi ngôn ngữ — trang dịch theo sở thích đã lưu mà không có cách đổi`);
  }
}

// ---------------------------------------------------------------------------
// 4g. A page that uses the brand fonts without loading them.
//
//     styles.css names 'Space Grotesk' for .brand, the headings and the numerals
//     that carry the product prices. A page that links the stylesheet but not the
//     font gets those rules with nothing to resolve to, and falls back to the
//     generic sans-serif — the brand's own typeface, gone, on exactly the page a
//     buyer is looking at.
//
//     public/admin.html did this, and nothing reported it: there was no check, and
//     the omission is invisible in a diff that only compares HTML structure. The
//     link block is copied into ten pages by hand, so "the other pages have it"
//     is not a property anything enforces.
//
//     It stays copied. Eleven occurrences of a 200-character <link> is a smaller
//     problem than a token every page has to resolve before its CSS applies, and
//     the check below is what makes the copies safe: a new page that forgets gets
//     told, instead of quietly rendering in Arial.
// ---------------------------------------------------------------------------
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  // Both forms. public/about.html links "/styles.css" and every other page links
  // "styles.css"; matching only one left the page with the absolute path — the
  // one that had actually lost its fonts — unexamined by a check written to catch
  // exactly that.
  if (!/href="\/?styles\.css"/.test(source)) continue;
  if (!/Space\+Grotesk/.test(source)) {
    fail("thiếu font thương hiệu", `public/${name}`,
      "nạp styles.css nhưng không nạp Space Grotesk/DM Sans — chữ thương hiệu sẽ rơi về sans-serif mặc định");
  }
}

// ---------------------------------------------------------------------------
// 4h. A refusal the browser cannot translate.
//
//     src/app.js answered 43 failures with `res.json({ error: "…tiếng Việt…" })`
//     and every page read that sentence before its own dictionary — the shape was
//     `payload.error || T('some.fallback')`, and the server was first. The visitor
//     who switched the shop to English was therefore told what went wrong in
//     Vietnamese, by the shop, including on the checkout form.
//
//     Nothing caught it, and nothing would have: the string was in the right place
//     grammatically, the audit only looked at HTML and at keys, and the sentence
//     was correct Vietnamese. It was a correct sentence in the wrong language for
//     the reader, which no spelling or accent check can see.
//
//     The rule is the one src/refuse.js exists to make possible: a refusal that
//     goes into a JSON body has to carry a `code` the dictionary can resolve. Both
//     halves of it. A sentence on its own is only allowed where nothing reads the
//     body as prose.
// ---------------------------------------------------------------------------
const VIETNAMESE_SENTENCE = /[\u00c0-\u1ef9]{2,}/;
for (const name of ["app.js", "store.js", "orders.js", "payments.js", "r2.js", "reviews.js", "rates.js", "geo.js", "notify.js"]) {
  const file = path.join("src", name);
  if (!existsSync(file)) continue;
  const source = await read(file);
  for (const match of source.matchAll(/res\.status\([^)]*\)\.json\(\{\s*error:\s*"([^"]+)"/g)) {
    if (VIETNAMESE_SENTENCE.test(match[1])) {
      fail("lỗi tiếng Việt cho trình duyệt", "ngôn ngữ khai báo sai", `src/${name}`,
        `gửi thẳng "${match[1].slice(0, 60)}" mà không có code — dùng refuse("khoá", "câu tiếng Việt", status) để trình duyệt dịch được`);
    }
  }
  // And the same, for a body built as a variable rather than an object literal.
  for (const match of source.matchAll(/json\(\{\s*error:\s*`([^`]+)`/g)) {
    fail("lỗi tiếng Việt cho trình duyệt", "ngôn ngữ khai báo sai", `src/${name}`,
      `gửi thẳng một câu nội suy "${match[1].slice(0, 60)}" mà không có code — dùng refuse()`);
  }
}

// Every key the server sends must exist in both halves of the dictionary. The
// orphan check above asks the opposite question — is anything in the dictionary
// unread — and neither would notice a key that is sent, is read, and is simply
// not there: the browser falls through to the sentence and the page is Vietnamese
// again, with no finding anywhere.
// Comments are removed before the scan. A key that appears only in prose is not
// a key anyone sends, and reading documentation as code produced thirty-eight
// phantom usages on the first run of this check — the same mistake
// objectLiteralAt above made, in a different parser.
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

for (const [name, source] of keyProducers) {
  for (const match of withoutComments(source).matchAll(/refuse\("([\w.]+)"/g)) {
    if (!declared.has(match[1])) {
      fail("khoá i18n chưa định nghĩa", name, `máy chủ gửi "${match[1]}" mà từ điển không có — trình duyệt sẽ hiện tiếng Việt`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4i. A page claiming a translation it does not have.
//
//     terms.html, privacy.html, refund.html and about.html each carried
//     `<meta property="og:locale:alternate" content="en_US">` — a statement to
//     every social scraper that an English version of the page exists. None of them
//     had one: they do not load i18n.js, and their prose is Vietnamese.
//
//     What made it worse than a harmless wrong tag is that each of those four
//     pages already said the opposite in its own hreflang, which listed `vi` and
//     `x-default` and nothing else. The page told two crawlers contradictory
//     things about itself, in markup written to agree.
//
//     So the rule is: if a page lists an alternate locale, it has to serve that
//     locale. index.html keeps its en_US because it genuinely has /en/ routes.
//     When the legal pages get English versions this stops being a finding, and
//     the check is the thing that has to notice — not the author.
// ---------------------------------------------------------------------------
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  const alternate = /property="og:locale:alternate" content="([^"]+)"/.exec(source);
  if (!alternate) continue;
  const hasAlternateRoute = /hreflang="en"/.test(source) || /\/en\//.test(source);
  if (!hasAlternateRoute) {
    fail("ngôn ngữ khai báo sai", `public/${name}`,
      `khai báo og:locale:alternate="${alternate[1]}" nhưng không phục vụ bản ${alternate[1].slice(0, 2)} — hreflang của chính trang này cũng chỉ liệt kê vi`);
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
//
//     The list itself is not written here. It is read out of src/pages.js, next to
//     the builder that fills the values, so a token the renderer learns is known
//     here the same edit — the hand-written copy this replaces had already drifted
//     ({{brandWordmark}} filled, "unknown"), failing the build on correct pages.
const readTokenList = (exportName) => {
  const block = pagesSource.match(new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\];`))?.[1] || "";
  return (block.match(/"([^"]+)"/g) || []).map((quoted) => quoted.replace(/"/g, ""));
};
const KNOWN_TOKENS = new Set([...readTokenList("PAGE_TOKENS"), ...readTokenList("COPY_TOKENS")]);
if (!KNOWN_TOKENS.size) {
  fail("placeholder lạ", "src/pages.js", "không đọc được PAGE_TOKENS/COPY_TOKENS — audit không thể biết token nào là hợp lệ");
}
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
// The rules are read out of src/robots.js — the module the server renders the file
// with — rather than scraped from src/app.js. They used to be scraped from app.js
// as `Disallow: "…"` literals, and moved to their own module made that capture come
// back empty: this check went from "verifies structured data does not point at a
// hidden page" to "always passes", with no red line anywhere. Reading the module
// means adding a private path is one edit that both the response and this check see.
const robotsSource = await read(path.join("src", "robots.js"));
const robotsBlock = robotsSource.match(/ROBOTS_DISALLOW\s*=\s*(?:Object\.freeze\()?\s*\[([\s\S]*?)\]/)?.[1] || "";
const blocked = new Set((robotsBlock.match(/'([^']+)'/g) || []).map((quoted) => quoted.replace(/'/g, "").replace(/\/$/, "")));
if (!blocked.size) {
  fail("schema chặn", "src/robots.js", "không đọc được ROBOTS_DISALLOW — audit không thể biết trang nào robots.txt cấm, nên mọi dữ liệu có cấu trúc đều bị coi là hợp lệ");
}
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
// So the names are read out of the renderer's own wiring instead of being written
// down, and a file carrying any token has to be named in the renderer at all. The
// wiring used to be eleven replaceAll literals inside renderPage; it is now one
// shared filler fed by PAGE_TOKENS in src/pages.js, so this check reads that list
// and additionally asserts renderPage still goes through the filler. If renderPage
// ever stops using it, every token fails loudly rather than silently passing again.
const renderStart = serverSource.indexOf("async function renderPage");
const renderBody = serverSource.slice(renderStart, serverSource.indexOf("const sendPage", renderStart));
if (!/fillPageTokens\s*\(/.test(renderBody)) {
  fail("token chưa nối", "src/app.js", "renderPage không còn dùng fillPageTokens — kiểm tra này không còn nhìn thấy token nào được nối");
}
const wiredTokens = new Set(readTokenList("PAGE_TOKENS"));
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
// 5f. A header that spells the brand out instead of reading it from configuration.
//
//     Every page's header carries the wordmark, and its last segment is styled
//     separately, so it cannot be a plain {{brandName}} substitution — which is
//     exactly why it was typed into fourteen places: seven HTML files, twice in most
//     of them, plus the product page the server builds in code.
//
//     Fourteen copies is fourteen chances to answer a rename with the old shop, and it
//     already happened: the product page is the surface a crawler reads most, and its
//     header kept announcing the old brand while the title, the canonical, the
//     structured data and every email had moved on.
//
//     The check above it could not see this. Section 4d counts og:site_name inside
//     public/*.html, and src/pages.js never exists as a file — so the one header that
//     is generated in code, and the one most likely to drift, was the one it was blind
//     to. So this asks a question with no brand value in it: does a site header carry
//     literal text, or does it carry the token?
//
//     Brand-value independent on purpose. CI sets BRAND_NAME to a fixture, so a check
//     built around the real name would pass there and catch nothing.
// ---------------------------------------------------------------------------
for (const name of htmlFiles) {
  const source = await read(path.join("public", name));
  for (const header of source.matchAll(/<a class="brand"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!header[1].includes("{{brandWordmark}}")) {
      fail("thương hiệu gõ cứng", `public/${name}`, `header viết chữ thật thay vì {{brandWordmark}} — đổi BRAND_NAME sẽ không áp dụng ở đây`);
    }
  }
}
// The generated one. src/pages.js is the header most likely to drift and the one no
// file-based check can reach.
for (const header of pagesSource.matchAll(/<a class="brand"[^>]*>([\s\S]*?)<\/a>/g)) {
  if (!header[1].includes("${brandWordmark()}")) {
    fail("thương hiệu gõ cứng", "src/pages.js", `header trang sản phẩm viết chữ thật thay vì \${brandWordmark()} — đây là trang crawler đọc nhiều nhất`);
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
// Every family of defect this file knows how to catch.
//
// The number used to be a literal — 17 — sitting under a comment that listed 19, so
// the one figure a reader was meant to sanity-check had already drifted from the
// list above it. That is the exact failure the file exists to prevent, committed by
// the file itself, and no gate could see it: a test asserting "groups === 17" would
// have kept passing while the list said 19.
//
// So the count is derived from the check labels the code actually registered. A new
// family cannot be added without the number moving, the number cannot be wrong, and
// the comment below stays a readable index rather than the source of truth.
//
//  1 link or asset with no file behind it
//  2 the same route registered twice
//  3 an i18n key in one language and missing in the other
//  3b an i18n key no page and no server module can reach
//  3c the same key written twice in one dictionary
//  4 a configured value also written into a file
//  4b the site's own host in deploy/ or scripts/
//  4bb the R2 bucket's origin list against APP_URL
//  4c display content sent in one language
//  4d the same identity declared twice on one page
//  4e a language switch the page cannot honour
//  4f a template placeholder nothing knows how to fill
//  5 structured data pointing at a page robots.txt forbids
//  5b Vietnamese written without its diacritics, in the storefront, in src/ and in
//     the operator-facing text of scripts/ and test/
//  5c a template token the renderer never fills
//  5d a template the renderer never sees, token or not
//  5e an hreflang pointing at a URL nothing answers
//  5f a hardcoded brand wordmark in HTML the server renders
//  6 a page nothing links to
//  7 a phrase from the fallback dictionary inside the dictionary itself
//  8 the same global declared by two scripts on one page
const REGISTERED = new Set(findings.map((item) => item.check));
// Families that ran and found nothing leave no trace in `findings`, so the labels
// they use have to be declared here. Adding a check without adding its label is
// still possible, and the audit.test.js test below is what holds this honest.
// Every label fail() can be called with. It is checked against the labels the
// run actually used, because a mismatch makes the audit report the wrong reason
// for a real finding: "check not declared in the list at the end of the file"
// tells whoever is looking that the gate itself is broken, which is both true
// and useless.
//
// It had drifted in six places, and in four of them only by a diacritic —
// "khoá" at the call site against "khóa" in this list, the same word written two
// ways. Nothing failed while that was true, because REGISTERED is built from the
// findings and a clean run produces none, so `unknown` is empty and the check
// passes. It would only have spoken up at the exact moment it was needed: the
// first real orphaned translation key, reported as a problem with the audit
// instead of with the dictionary.
//
// The labels below are the call sites' spelling, character for character.
const DECLARED = [
  "link gãy", "route trùng", "thiếu bản dịch", "khoá i18n mồ côi", "khoá i18n chưa định nghĩa",
  "khoá i18n trùng", "nút đổi ngữ không có từ điển", "thừa nhiệu",
  "domain gõ tay", "email gõ tay", "R2 CORS lệch", "R2 CORS thừa origin",
  "ngôn ngữ thiếu", "thương hiệu khai báo hai lần", "thừa ngôn ngữ", "placeholder lạ",
  "schema chặn", "tiếng Việt không dấu", "tiếng Việt ở phía máy chủ", "token chưa nối",
  "trang chưa render", "hreflang chết", "thương hiệu gõ cứng", "trang mồ côi",
  "trùng tên toàn cục", "chữ rỗng", "thiếu font thương hiệu",
  "lỗi tiếng Việt cho trình duyệt", "ngôn ngữ khai báo sai",
];
const unknown = [...REGISTERED].filter((label) => !DECLARED.includes(label));
if (unknown.length) {
  console.error(`[audit] Nhom kiem tra chua khai bao trong danh sach cuoi file: ${unknown.join(", ")}`);
  process.exitCode = 1;
}
const groups = new Set([...DECLARED, ...REGISTERED]).size;
for (const item of findings) console.error(`FAIL  ${item.check.padEnd(18)} ${item.file}: ${item.detail}`);
console.log(`\n[audit] ${groups} nhom kiem tra, ${findings.length} van de.`);
if (skipped.length) {
  console.log(`[audit] Bo qua ${skipped.length} nhom vi thieu cau hinh: ${skipped.join(", ")}`);
  console.log("[audit] Dat APP_URL va SUPPORT_EMAIL (xem .env.example) de chay day du.");
}
if (!findings.length) console.log("[audit] PASS: không có domain gõ tay, route trùng, link gãy, tiếng Việt mất dấu hay khoá i18n mồ côi.");
else process.exitCode = 1;
