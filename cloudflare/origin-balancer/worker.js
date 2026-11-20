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
// Cache entries created before the gzip change carry plain HTML and no version
// marker. Tagging every new entry lets this version ignore them instead of
// serving an uncompressed page for the rest of the origin's one-day TTL.
const CACHE_VERSION = "gzip-20261120";

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

// workerd's `encodeBody: "manual"` flag is write-only and is silently dropped
// when a Response is rebuilt from a plain object init (workerd#7066). With a
// Content-Encoding header still present the runtime then encodes the body a
// SECOND time and the browser receives garbage. Passing the original Response
// as the init preserves the flag, and headers.set() still lets us tag it.
export const withHeader = (response, name, value) => {
  const out = new Response(response.body, response);
  out.headers.set(name, value);
  return out;
};

/** Workers fetch() transparently decompresses gzip from an upstream. Asking the
 *  origin for identity bytes makes decompression impossible here — the edge does
 *  its own gzip below, so the compressed representation is chosen exactly once. */
export const upstreamHeaders = (headers) => {
  const result = new Headers(headers);
  result.set("Accept-Encoding", "identity");
  return result;
};

export const acceptsGzip = (headers) => /\bgzip\b/i.test(String(headers.get("accept-encoding") || ""));

export const isCurrentCache = (response) => Boolean(response && response.headers.get("x-svd-cache-v") === CACHE_VERSION);

/** Return pre-compressed HTML. `encodeBody: "manual"` is what keeps workerd from
 *  encoding these bytes again; Vary keeps gzip and identity cache entries apart. */
export const gzipHtmlResponse = (response) => {
  const body = response.body.pipeThrough(new CompressionStream("gzip"));
  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.set("Vary", "Accept-Encoding");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    encodeBody: "manual",
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

    const origins = parseOrigins(env.ORIGINS);
    if (!origins.length) return new Response("No origins configured", { status: 503 });

    const url = new URL(request.url);
    const client = clientAddress(request.headers);
    const identity = `${client}|${url.pathname}`;
    const cooldown = Number(env.COOLDOWN_MS) || DEFAULT_COOLDOWN_MS;
    const cacheable = isCacheable(request.method, url.pathname);

    if (cacheable) {
      const cached = await caches.default.match(request);
      if (isCurrentCache(cached)) {
        return withHeader(cached, "X-SVD-Origin", "edge-cache");
      }
    }

    let lastStatus = 502;
    for (const origin of orderOrigins(origins, identity)) {
      try {
        const upstream = new URL(url.pathname + url.search, `${origin}/`);
        const upstreamResponse = await fetch(upstream, {
          method: request.method,
          headers: upstreamHeaders(request.headers),
          body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
          redirect: "manual",
        });
        const looksHtml = (upstreamResponse.headers.get("content-type") || "").includes("text/html");
        const bodyHead = upstreamResponse.status >= 500 || looksHtml
          ? (await upstreamResponse.clone().text()).slice(0, 2000)
          : "";
        if (isSuspension(upstreamResponse.status, bodyHead)) {
          markDown(origin, cooldown);
          lastStatus = upstreamResponse.status >= 500 ? upstreamResponse.status : 502;
          continue;
        }
        markUp(origin);
        // The origin answered identity bytes, so this is the only place HTML is
        // compressed. Non-HTML and clients without gzip keep the raw body.
        const response = looksHtml && acceptsGzip(request.headers)
          ? gzipHtmlResponse(upstreamResponse)
          : upstreamResponse;
        const tagged = withHeader(response, "X-SVD-Origin", origin.replace(/^https?:\/\//, ""));
        if (cacheable) {
          const versioned = withHeader(tagged, "X-SVD-Cache-V", CACHE_VERSION);
          ctx.waitUntil(caches.default.put(request, versioned.clone()));
          // Build the stale copy with the same safe helper — a plain object init
          // would drop the manual encoding flag and double-encode the fallback.
          const stale = withHeader(versioned, "Cache-Control", "public, max-age=2592000");
          ctx.waitUntil(caches.default.put(staleKey(request.url), stale.clone()));
        }
        return tagged;
      } catch (error) {
        markDown(origin, cooldown);
        lastStatus = 502;
      }
    }

    if (cacheable) {
      const stale = await caches.default.match(staleKey(request.url));
      if (isCurrentCache(stale)) {
        return withHeader(withHeader(stale, "Warning", '110 - "Response is stale"'), "Cache-Control", "no-store");
      }
    }
    return new Response(`Bad gateway (${lastStatus})`, { status: 502 });
  },
};
