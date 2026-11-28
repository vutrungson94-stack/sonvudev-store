// Free origin balancer. Cloudflare Workers is the only free edge layer that can
// both spread visits across several free hosts and take a dead one out of the
// rotation. Cloudflare Load Balancer (the built-in product) is paid; DNS
// round-robin has no health signal and keeps sending visitors to a suspended
// host. This Worker sits on the zone route and proxies each request to one of
// the configured origins, chosen by a deterministic hash of client IP + path.
//
// Why hash, not a counter: a shared counter needs KV/Durable Object writes on
// every request (cost, eventual consistency, latency). Hashing the visitor's IP
// spreads a population evenly without shared state, and keeps one visitor on
// one origin — valuable when a free host has just woken from spin-down.
//
// Caching uses the Cache API keyed by the ORIGINAL request URL, not the upstream
// URL. Otherwise each origin would get its own cache entry and the HIT rate
// would be divided by the number of origins. A second "stale" entry is kept
// with a long TTL and served with Warning:110 only when every origin fails —
// that is the read-only failover when all free hosts are suspended at once.

const DEFAULT_COOLDOWN_MS = 120_000;
const DEFAULT_MAINTENANCE_ETA_MS = 30 * 60 * 1000;
const LOCALES = ['vi', 'en', 'de', 'es', 'fr', 'ja', 'zh'];

// The edge has no filesystem, so these seven display strings live here. The
// locale CODES are the same ones as src/i18n-registry.mjs / Locales; do not add
// a language here without adding it to the shipped catalogs first.
const MAINTENANCE_TEXT = {
  vi: { title: 'SonVuDev đang bảo trì', body: 'Để giữ cửa hàng ổn định cho bạn, chúng tôi đang tạm ngưng một số dịch vụ. Đơn hàng và sản phẩm bạn đã lưu vẫn an toàn.', again: 'Dự kiến quay lại lúc', retry: 'Thử lại', rateTitle: 'Hơi quá tải một chút', rateBody: 'Bạn đang gửi yêu cầu nhanh hơn mức chúng tôi có thể xử lý. Vui lòng chờ vài phút rồi thử lại — sản phẩm vẫn ở đây.' },
  en: { title: 'SonVuDev is under maintenance', body: 'We are briefly pausing some services to keep the shop stable for you. Your saved products and orders are safe.', again: 'Expected back at', retry: 'Try again', rateTitle: 'A little too fast', rateBody: 'You are sending requests faster than we can serve them. Please wait a few minutes and try again — your products are still here.' },
  de: { title: 'SonVuDev wird gewartet', body: 'Wir pausieren kurzzeitig einige Dienste, damit der Shop für Sie stabil bleibt. Ihre gespeicherten Produkte und Bestellungen sind sicher.', again: 'Voraussichtlich wieder verfügbar:', retry: 'Erneut versuchen', rateTitle: 'Etwas zu schnell', rateBody: 'Sie senden Anfragen schneller, als wir sie bedienen können. Bitte warten Sie einige Minuten — Ihre Produkte bleiben erhalten.' },
  es: { title: 'SonVuDev está en mantenimiento', body: 'Pausamos brevemente algunos servicios para mantener la tienda estable. Tus productos y pedidos guardados siguen seguros.', again: 'Volvemos aproximadamente a las', retry: 'Reintentar', rateTitle: 'Un poco demasiado rápido', rateBody: 'Estás enviando solicitudes más rápido de lo que podemos atenderlas. Espera unos minutos y vuelve a intentarlo.' },
  fr: { title: 'SonVuDev est en maintenance', body: 'Nous suspendons brièvement certains services pour garder la boutique stable. Vos produits et commandes enregistrés sont en sécurité.', again: 'Retour prévu à', retry: 'Réessayer', rateTitle: 'Un peu trop vite', rateBody: 'Vos requêtes arrivent plus vite que nous ne pouvons les traiter. Patientez quelques minutes — vos produits restent disponibles.' },
  ja: { title: 'SonVuDev はメンテナンス中です', body: 'ショップを安定してご利用いただくため、一部のサービスを一時停止しています。保存した商品と注文はそのままです。', again: '再開予定時刻', retry: '再試行', rateTitle: '少し速すぎます', rateBody: 'リクエストが多すぎます。数分お待ちになってから再度お試しください。商品はそのまま保存されています。' },
  zh: { title: 'SonVuDev 正在维护', body: '为了保持商店稳定，我们短暂暂停了部分服务。您保存的商品和订单依然安全。', again: '预计恢复时间', retry: '重试', rateTitle: '请求稍快', rateBody: '您的请求过于频繁。请稍等几分钟再试 — 商品仍为您保留。' },
};

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** URL prefix wins; Accept-Language is only a fallback. */
export const localeOf = (request) => {
  const first = new URL(request.url).pathname.split('/').filter(Boolean)[0] || '';
  if (LOCALES.includes(first)) return first;
  const accepted = String(request.headers.get('accept-language') || '').toLowerCase();
  for (const part of accepted.split(',')) {
    const code = part.trim().split(';')[0].slice(0, 2);
    if (LOCALES.includes(code)) return code;
  }
  return 'vi';
};

export const maintenanceUntil = (env, now = Date.now()) => {
  const raw = String(env?.MAINTENANCE_UNTIL || '').trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const retryAfterSeconds = (until, now = Date.now()) =>
  Math.max(1, Math.ceil((until - now) / 1000));

export const formatReturnDate = (locale, until) => {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(until));
  } catch {
    return new Date(until).toISOString();
  }
};

const page = ({ title, body, again = '', retry = '', until = 0, locale = 'vi', reason = '' }) => `<!doctype html>
<html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1f19;color:#eef7f2;font:16px/1.6 system-ui,sans-serif}
main{max-width:34rem;margin:2rem;padding:2rem;border-radius:20px;background:#123128;box-shadow:0 20px 60px #0006}
h1{font-size:1.7rem;margin:0 0 1rem;color:#7ce0b6}p{margin:.75rem 0}.when{display:block;margin:1.25rem 0;font-weight:700;color:#fff}
a{display:inline-block;margin-top:1rem;padding:.7rem 1.2rem;background:#7ce0b6;color:#0b1f19;border-radius:999px;text-decoration:none;font-weight:700}
small{display:block;margin-top:1.5rem;opacity:.75}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>
${reason ? `<p>${escapeHtml(reason)}</p>` : ''}
${until ? `<span class="when">${escapeHtml(again)}: ${escapeHtml(formatReturnDate(locale, until))}</span>` : ''}
<a href="/">${escapeHtml(retry || 'Retry')}</a></main></body></html>`;

export const maintenancePage = ({ locale = 'vi', until = 0, reason = '', now = Date.now() }) => {
  const text = MAINTENANCE_TEXT[locale] || MAINTENANCE_TEXT.vi;
  return page({ ...text, locale, until: until || now, reason });
};

export const rateLimitPage = ({ locale = 'vi', retryAfter = 900 }) => {
  const text = MAINTENANCE_TEXT[locale] || MAINTENANCE_TEXT.vi;
  return page({ title: text.rateTitle, body: text.rateBody, locale, retry: text.retry,
    until: Date.now() + retryAfter * 1000, again: locale === 'vi' ? 'Vui lòng thử lại sau' : 'Please retry after' });
};

export const isRateLimited = (status) => status === 429;
export const browserNavigation = (headers) =>
  String(headers.get('accept') || '').includes('text/html')
  && String(headers.get('sec-fetch-mode') || '') === 'navigate';

/** FNV-1a, small, fast, deterministic in Workers and in Node tests. */
const hash32 = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const parseOrigins = (value) => [...new Set(
  String(value || "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => /^https?:\/\/[^\s/]+$/i.test(entry)),
)];

// Per-isolate cooldown. Each isolate learns a dead origin on its first failing
// request; there is no shared state to keep in sync and no write cost.
const downUntil = new Map();
export const isDown = (origin, now = Date.now()) => (downUntil.get(origin) || 0) > now;
export const markDown = (origin, cooldown, now = Date.now()) => downUntil.set(origin, now + cooldown);
export const markUp = (origin) => downUntil.delete(origin);

/** Pick the healthy origin whose hash slot matches this visitor; if all are
 *  cooling down, still pick one so the first request can re-probe them. */
export const pickOrigin = (origins, identity, now = Date.now()) => {
  if (!origins.length) return null;
  const healthy = origins.filter((origin) => !isDown(origin, now));
  const pool = healthy.length ? healthy : origins;
  return pool[hash32(identity) % pool.length];
};

export const orderOrigins = (origins, identity, now = Date.now()) => {
  const healthy = origins.filter((origin) => !isDown(origin, now));
  const cooling = origins.filter((origin) => isDown(origin, now));
  const pool = healthy.length ? healthy : origins; // all cooling: re-probe
  const first = pool[hash32(identity) % pool.length];
  return [first, ...pool.filter((origin) => origin !== first), ...(healthy.length ? cooling : [])];
};

export const isCacheable = (method, pathname) =>
  method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/admin");

export const isSuspension = (status, bodyHead) =>
  status >= 500 || /service has been suspended|application error|origin is unreachable/i.test(String(bodyHead || ""));

export const staleKey = (url) => {
  const parsed = new URL(url);
  parsed.searchParams.set("__svd_stale", "1");
  return parsed.toString();
};

const withHeader = (response, name, value) => {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** www → apex, decided before the upstream Host is rewritten.
 *
 *  The app has the same redirect (src/app.js), but by the time it runs the
 *  Worker has fetched the origin by its own hostname; the app sees fly.dev and
 *  cannot know the buyer typed www. Redirecting here keeps one canonical address
 *  and stops the cached homepage being served twice. */
export const apexRedirect = (value, host = "") => {
  const url = new URL(value);
  const hostname = String(host || url.hostname).split(":")[0].toLowerCase();
  if (!hostname.startsWith("www.")) return null;
  const apex = hostname.slice(4);
  // Only redirect when one of the two names is this request's own host. A
  // spoofed Host header must not turn the Worker into an open redirect.
  if (url.hostname !== apex && url.hostname !== hostname) return null;
  url.hostname = apex;
  return url.toString();
};

/** The visitor's address, taken from the edge header the client cannot forge. */
export const clientAddress = (headers) => String(
  headers.get("cf-connecting-ip")
    || headers.get("x-forwarded-for")
    || headers.get("cf-ray")
    || "anon",
).split(",")[0].trim();

export default {
  async fetch(request, env, ctx) {
    const redirect = apexRedirect(request.url, request.headers.get("host"));
    if (redirect) return Response.redirect(redirect, 308);

    const now = Date.now();
    const locale = localeOf(request);
    const reason = String(env?.MAINTENANCE_REASON || '').trim();
    const forcedUntil = maintenanceUntil(env, now);
    if (forcedUntil > now) {
      return new Response(maintenancePage({ locale, until: forcedUntil, reason, now }), {
        status: 503,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': String(retryAfterSeconds(forcedUntil, now)),
          'x-svd-origin': 'maintenance',
        },
      });
    }

    const origins = parseOrigins(env.ORIGINS);
    if (!origins.length) return new Response("No origins configured", { status: 503 });

    const url = new URL(request.url);
    const client = clientAddress(request.headers);
    const identity = `${client}|${url.pathname}`;
    const cooldown = Number(env.COOLDOWN_MS) || DEFAULT_COOLDOWN_MS;
    const cacheable = isCacheable(request.method, url.pathname);

    if (cacheable) {
      const cached = await caches.default.match(request);
      if (cached) return withHeader(cached, "X-SVD-Origin", "edge-cache");
    }

    let lastStatus = 502;
    for (const origin of orderOrigins(origins, identity)) {
      try {
        const upstream = new URL(url.pathname + url.search, `${origin}/`);
        const response = await fetch(upstream, {
          method: request.method,
          headers: request.headers,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
          redirect: "manual",
        });
        const looksHtml = (response.headers.get("content-type") || "").includes("text/html");
        const bodyHead = response.status >= 500 || looksHtml
          ? (await response.clone().text()).slice(0, 2000)
          : "";
        if (isRateLimited(response.status)) {
          // A throttled origin is healthy but busy: cool it briefly and try the
          // next one. API clients keep their JSON 429 (with Retry-After);
          // browser navigations get a friendly page if every origin is busy.
          markDown(origin, Math.max(10_000, Math.floor(cooldown / 4)));
          lastStatus = 429;
          if (!browserNavigation(request.headers) || url.pathname.startsWith("/api/")) {
            return withHeader(withHeader(response, "Retry-After", "900"), "X-SVD-Origin",
              origin.replace(/^https?:\/\//, ""));
          }
          continue;
        }
        if (isSuspension(response.status, bodyHead)) {
          markDown(origin, cooldown);
          lastStatus = response.status >= 500 ? response.status : 502;
          continue;
        }
        markUp(origin);
        const tagged = withHeader(response, "X-SVD-Origin", origin.replace(/^https?:\/\//, ""));
        if (cacheable) {
          ctx.waitUntil(caches.default.put(request, tagged.clone()));
          const staleHeaders = Object.fromEntries(tagged.headers);
          staleHeaders["Cache-Control"] = "public, max-age=2592000";
          ctx.waitUntil(caches.default.put(staleKey(request.url), new Response(tagged.clone().body, {
            status: 200, headers: staleHeaders,
          })));
        }
        return tagged;
      } catch (error) {
        markDown(origin, cooldown);
        lastStatus = 502;
      }
    }

    if (cacheable) {
      const stale = await caches.default.match(staleKey(request.url));
      if (stale) {
        return withHeader(withHeader(stale, "Warning", '110 - "Response is stale"'), "Cache-Control", "no-store");
      }
    }
    // Every origin is down (or throttled). No bare 502/503 body: give the
    // visitor a localized page with an honest ETA and a no-store header so
    // the edge never caches the degraded state.
    const etaMs = Number(env?.MAINTENANCE_ETA_MS) || DEFAULT_MAINTENANCE_ETA_MS;
    const until = Date.now() + Math.max(etaMs, 60_000);
    if (lastStatus === 429) {
      return new Response(rateLimitPage({ locale }), {
        status: 429,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': '900',
          'x-svd-origin': 'rate-limited',
        },
      });
    }
    return new Response(maintenancePage({ locale, until, reason, now: Date.now() }), {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(Math.ceil(Math.max(etaMs, 60_000) / 1000)),
        'x-svd-origin': 'maintenance',
      },
    });
  },
};
