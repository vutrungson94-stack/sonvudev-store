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

export default {
  async fetch(request, env, ctx) {
    const origins = parseOrigins(env.ORIGINS);
    if (!origins.length) return new Response("No origins configured", { status: 503 });

    const url = new URL(request.url);
    const client = request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")
      || request.headers.get("cf-ray")
      || "anon";
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
    return new Response(`Bad gateway (${lastStatus})`, { status: 502 });
  },
};
