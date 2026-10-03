import dns from "node:dns/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { looksPlaceholder } from "../src/config.js";
import { resolvePaypalEnvironment } from "../src/paypal-environment.js";
import { corsDiff, hostOf } from "./lib/cors.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), override: true });
const value = (key) => (process.env[key] || "").trim();
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const appUrl = value("APP_URL");

// ---------------------------------------------------------------------------
// The one setting no other check here can reach, checked before anything that
// needs the network so a mistake in it costs a minute rather than a deploy.
//
// cloudflare/r2-cors.json is applied to the bucket by hand and read by nothing, so
// a stale origin list is invisible to every other row in this file and to the
// health endpoint. Its failure mode is also the worst one available: the admin panel
// asks the server for a presigned URL and then PUTs to R2 from the browser, so a
// CORS refusal stops the only release-publishing action in the shop, from the only
// page the owner can open, with no message on the page.
//
// The comparison uses the same function as `npm run r2:cors`, so this row and the
// repair command cannot disagree about what "correct" is. The fix is printed, not
// just named.
// ---------------------------------------------------------------------------
try {
  const corsFile = JSON.parse(await readFile(path.join(root, "cloudflare", "r2-cors.json"), "utf8"));
  const diff = corsDiff(corsFile, appUrl);
  add("R2 CORS khớp APP_URL", !diff.missing.length,
    diff.missing.length
      ? `thiếu ${diff.missing.join(", ")} trong cloudflare/r2-cors.json — upload file từ trang quản trị sẽ bị chặn. Sửa: npm run r2:cors:write`
      : diff.extra.length
        ? `khớp, nhưng còn ${diff.extra.length} origin thừa (${diff.extra.join(", ")}) không do APP_URL sinh ra`
        : `khớp, ${diff.required.length} origin cho ${hostOf(appUrl) || "APP_URL"}`);
} catch (error) {
  add("R2 CORS khớp APP_URL", false, `không đọc được cloudflare/r2-cors.json: ${error.message}`);
}

// Production means HTTPS on a real host. It used to be compared against one
// hardcoded domain, so every staging and preview deploy failed this check and the
// real thing was the only thing it could ever pass. What actually matters is the
// shape, and that is what this asserts now.
const productionUrl = /^https:\/\/(?!localhost|127\.|0\.0\.0\.0)[a-z0-9.-]+\.[a-z]{2,}$/i.test(appUrl);
add("APP_URL is a production https host", productionUrl, appUrl || "missing");
add("Admin token", !looksPlaceholder(value("ADMIN_API_TOKEN")), value("ADMIN_API_TOKEN") ? "configured" : "missing");
add("Supabase URL", /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value("SUPABASE_URL")), value("SUPABASE_URL") ? "configured" : "missing");
add("Supabase secret key", !looksPlaceholder(value("SUPABASE_SERVICE_ROLE_KEY")), value("SUPABASE_SERVICE_ROLE_KEY") ? "configured" : "missing");
add("Cloudflare R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].every((key) => !looksPlaceholder(value(key))), isConfigured(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) ? "configured" : "missing");
// Validates the credentials for real. A non-empty string is not proof they work.
const paypalClientId = value("PAYPAL_CLIENT_ID");
const paypalClientSecret = value("PAYPAL_CLIENT_SECRET");
// The rule itself lives in src/paypal-environment.js, shared with src/config.js. It
// used to be written out here a second time, and the two copies agreed only by
// accident — which is how a host could be configured one way and checked another.
//
// Read as a fact to be verified, not as a value with a fallback: an unset or
// unrecognised value fails, and it fails before any network call, because there is
// nothing to authenticate against if the environment cannot be named.
const paypalEnv = resolvePaypalEnvironment(value("PAYPAL_ENVIRONMENT"));
const paypalEnvironment = paypalEnv.environment;
const paypalBase = paypalEnv.apiBase;
const paypalFilled = isConfigured(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);

if (!paypalEnv.isSet) {
  add("PayPal", false, `${paypalEnv.reason} — mặc định là sandbox, và sandbox không nhận tiền thật`);
} else if (!paypalFilled) {
  add("PayPal", false, "missing");
} else if (paypalClientId === paypalClientSecret) {
  add("PayPal", false, "Client ID and Secret are identical, copy-paste error");
} else {
  try {
    const response = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10000),
    });
    const body = response.ok ? "authenticated" : `HTTP ${response.status} ${(await response.json().catch(() => ({}))).error_description || "rejected"}`;
    add("PayPal", response.ok, `${paypalEnvironment}, ${body}`);
  } catch (error) {
    add("PayPal", false, `lookup failed: ${error.message}`);
  }
}
add("PayPal webhook", !looksPlaceholder(value("PAYPAL_WEBHOOK_ID")), value("PAYPAL_WEBHOOK_ID") ? "configured" : "missing");
// The one question "has this been filled in", answered by the same rule the server
// uses. The sentence that marks an unset value was written out four times — twice in
// config.js and twice here, each with its own regex, and they did not agree:
// "your_account_number" was real to the shop and missing to this check, "your-secret"
// was real to the shop and configured to this check. That is a shop that offers a
// transfer it has no account for while its own pre-deploy check calls it missing, and
// which one you believe depends on which file you read.
//
// It is now one exported rule. Nothing in this file decides what a placeholder is.
add("Bank transfer", ["BANK_NAME", "BANK_ACCOUNT_NAME", "BANK_ACCOUNT_NUMBER"].every((key) => !looksPlaceholder(value(key))), ["BANK_NAME", "BANK_ACCOUNT_NUMBER"].every((key) => !looksPlaceholder(value(key))) ? "configured" : "missing");
add("Bank BIN (VietQR)", /^\d{6}$/.test(value("BANK_BIN")), value("BANK_BIN") || "missing");
add("MoMo wallet", !looksPlaceholder(value("MOMO_ACCOUNT_NUMBER")), value("MOMO_ACCOUNT_NUMBER") ? "configured" : "optional, missing");
add("ZaloPay wallet", !looksPlaceholder(value("ZALOPAY_ACCOUNT_NUMBER")), value("ZALOPAY_ACCOUNT_NUMBER") ? "configured" : "optional, missing");

// Order mail is what tells a buyer their order exists, when it expires and when
// the money arrived. Unconfigured, all three mails are silently written to
// data/outbox instead of being delivered, so a green run here still needs it.
const resendKey = value("RESEND_API_KEY");
if (!resendKey) {
  add("Order email", false, "RESEND_API_KEY missing, mail is only written to data/outbox");
} else {
  try {
    const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${resendKey}` }, signal: AbortSignal.timeout(10000) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      add("Order email", true, `resend, ${body.length || 0} domain(s)`);
    } else if (response.status === 401 && /only send/i.test(String(body.message || ""))) {
      // A key scoped to sending cannot list domains, and that is the setting we
      // want. Reporting this as a failure would push the owner towards handing
      // back full access to their whole Resend account.
      add("Order email", true, "resend, key giới hạn quyền gửi (đúng cấu hình). Xác minh thật: npm run email:check -- <email của bạn> created");
    } else {
      add("Order email", false, `HTTP ${response.status} ${body.message || "rejected"}`);
    }
  } catch (error) {
    add("Order email", false, `lookup failed: ${error.message}`);
  }
}
// The sender is whatever EMAIL_FROM says, checked only for the shape a mail API
// needs. A literal address used to sit in the fallback, so this check agreed with
// itself about a sender the shop had already replaced — and reported a healthy
// configuration for a domain it was not sending from.
const emailFrom = value("EMAIL_FROM");
add("Email sender", /^[^<]+<[^>]+>$/.test(emailFrom), emailFrom || "(chưa đặt EMAIL_FROM)");
const windowHours = Number(value("ORDER_PAYMENT_WINDOW_HOURS") || "24");
add("Order payment window", Number.isFinite(windowHours) && windowHours >= 1, `${windowHours}h before an unpaid order is cancelled`);

function isConfigured(keys) { return keys.every((key) => !looksPlaceholder(value(key))); }
if (appUrl) {
  const host = new URL(appUrl).hostname;
  // The address, on its own, proves very little — and the version of this check that
  // printed it as a PASS was wrong in a way worth writing down.
  //
  // A network that filters the web — a corporate resolver, an endpoint agent, a
  // parental filter — answers DNS with the address of its own block page rather than
  // an error. So the lookup succeeds, this row goes green, and it names an address
  // belonging to the filter. It read "PASS DNS A record: 208.91.112.55" on a machine
  // where that address was Fortinet's: it had verified the local filter and called
  // it the shop's DNS.
  //
  // A green check that reports something other than what it measured is worse than no
  // check, because it is trusted. So the address is kept — it is the first thing worth
  // knowing — and the HTTP result below is folded in, because an address that does not
  // serve the shop is not this domain's address. The two are read together and the
  // reason is named.
  let resolved = [];
  let lookupError = null;
  try {
    // dns.resolve4() queries DNS servers directly, so it fails whenever a local
    // resolver blocks direct queries (127.0.0.1, AdGuard, corporate DNS).
    // dns.lookup() goes through the OS resolver and matches what the browser sees.
    const addresses = await dns.lookup(host, { all: true });
    resolved = [...new Set(addresses.filter((entry) => entry.family === 4).map((entry) => entry.address))];
  } catch (error) { lookupError = error.message; }

  let reachable = false;
  try {
    const response = await fetch(`${appUrl}/api/health`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const body = response.ok ? await response.text() : "";
    // A blocking resolver does not return an error, it returns a page. On a
    // managed network — corporate DNS behind a filtering service, an endpoint
    // agent with URL filtering — the shop comes back as an HTML block page, and
    // without this the check reports "HTTP 403" and leaves you looking at the
    // server instead of at the machine you are standing on.
    //
    // The tell is that the body is HTML saying it blocked us. JSON would be the
    // real endpoint; a captcha or a Fortinet/Kaspersky portal is not.
    const blocked = /<\s*html|Web Page Blocked|Secure DNS Service Portal|captcha|Access Denied/i.test(body);
    if (blocked) {
      add("HTTPS health", false, `mạng này đang chặn miền (trả về trang chặn của bộ lọc DNS, HTTP ${response.status}). Site có thể vẫn bình thường — chạy lại trên mạng khác, ví dụ 4G.`);
    } else {
      const health = response.ok ? JSON.parse(body) : null;
      const summary = health ? JSON.stringify({ persistence: health.persistence, r2: health.r2, paypal: health.paypal, bank: health.bank }) : `HTTP ${response.status}`;
      add("HTTPS health", response.ok && health?.ok === true, summary);
      // A reachable server is not a store that can take money. Without R2 the
      // catalog hides every product, without bank/paypal checkout cannot complete,
      // and local-json means orders vanish on the next deploy.
      if (health) {
        add("Store is sellable", health.r2 === true, health.r2 ? "R2 connected, products are visible" : "r2=false, storefront hides every product");
        add("Payments live", health.paypal === true && health.bank === true, `paypal=${health.paypal}, bank=${health.bank}`);
        add("Database persistent", health.persistence === "supabase", health.persistence === "supabase" ? "supabase" : `${health.persistence}, orders are not durable`);
      }
    }
    // The DNS row, decided by what was actually reached. An address that came back
    // while the shop did not is this network's filter answering, not this domain's
    // record — and saying so is the difference between "your DNS is wrong" and "your
    // wifi blocks the shop", which are different problems with different fixes.
    reachable = response.ok && !blocked;
  } catch (error) {
    // A TLS failure and a dead server are different problems with different fixes,
    // and undici buries the real reason one level down: `fetch` rejects with
    // "fetch failed" and the diagnosis is in `cause`.
    //
    // CRYPT_E_NO_REVOCATION_CHECK is a corporate-network symptom — the machine
    // could not reach the certificate's revocation list — and says nothing about
    // the site's certificate. Reporting it as a bare "fetch failed" is what makes
    // people go looking at the server instead of at the network they are on.
    const chain = [];
    for (let node = error, depth = 0; node && depth < 5; node = node.cause, depth += 1) {
      chain.push(String(node.message || node.code || node));
    }
    const cause = chain.join(" <- ");
    const revocation = /revocation|CRYPT_E_NO_REVOCATION/i.test(cause);
    // A TLS-intercepting proxy — the default on a managed endpoint — answers with
    // its own self-signed certificate. Node refuses it, so the handshake dies and
    // reports "fetch failed", which reads exactly like the site being down when the
    // site is not involved at all. This is the single most misleading failure this
    // check can produce, because the fix lives on the machine, not the server.
    const intercepted = /self-signed|unable to verify|SELF_SIGNED|DEPTH_ZERO/i.test(cause);
    const filtered = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|socket hang up/i.test(cause);
    add("HTTPS health", false, intercepted
      ? `may nay dang bi proxy cong ty giai phong TLS, tra ve chung thu tu ky (${chain[chain.length - 1]}). KHONG phai loi chung thu cua site. Node khong tin CA cua proxy. Chay lai tren 4G, hoac bat SSL inspection trong Kaspersky.`
      : revocation
        ? `may nay khong kiem tra duoc CRL cua chung thu (${chain[chain.length - 1]}) — loi mang noi bo, KHONG phai loi chung thu cua site. Thu lai tren 4G.`
        : filtered
          ? `may nay khong pho giao duoc domain (${chain[chain.length - 1]}) — thu lai tren mang khac bi chan`
          : cause);
    reachable = false;
  }

  // The DNS row, decided by what was actually reached rather than by the fact that
  // something came back.
  //
  // An address that arrived while the shop did not is this network's filter
  // answering, not this domain's record. Saying so is the difference between "your
  // DNS is misconfigured" and "your wifi blocks the shop" — different problems,
  // different fixes, and only one of them is worth touching a domain for.
  add("DNS A record", lookupError ? false : resolved.length > 0 && reachable,
    lookupError ? `lookup failed: ${lookupError}`
      : resolved.length && !reachable ? `${resolved.join(", ")} — có địa chỉ nhưng máy này không mở được shop, nên đây là trang chặn của mạng bạn chứ không phải bản ghi DNS thật. Chạy lại trên 4G.`
      : resolved.join(", "));
}

// When the live site is unreachable from this machine, the checks that depend on
// it are skipped rather than failed, and the run is reported as inconclusive
// instead of broken. A gate that cannot tell "the site is down" from "I cannot
// see the site" gets ignored exactly when it matters most.
const networkBlocked = checks.some((check) => /đang chặn miền|không kiểm tra được CRL|không phỏ giao được domain|giải phóng TLS|giai phong TLS/i.test(check.detail));

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} production checks passed.`);
if (networkBlocked) {
  console.error("\nKHONG KET LUAN DUOC: may nay khong truy cap duoc site.\n");
  console.error("Một số check cuối bảng phải chạy trên mạng không bị chặn (4G, mạng nhà riêng).");
  console.error("Cac check khac — cau hinh, PayPal, email, DNS — da dung va khong phu thuoc site.");
  process.exitCode = 1;
} else if (failed.length) process.exitCode = 1;
