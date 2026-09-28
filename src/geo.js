import { env } from "./config.js";

// Best-effort country lookup for the visitor. It is used only to order and
// explain the payment options, never to gate one: a buyer in Vietnam can still
// pick PayPal, and a buyer abroad can still hold a Vietnamese bank account.
//
// Render terminates TLS itself, so there is no CF-IPCountry header to read and
// the lookup has to leave the machine over HTTPS. Both providers below answer
// without an API key. Every failure path returns null, which the storefront
// reads as "unknown" and answers with the neutral domestic-first layout.

const publicIpv4 = (ip) => {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return a < 224;
};

export const isRoutable = (ip) => {
  const address = String(ip || "").replace(/^::ffff:/, "").trim();
  if (!address) return false;
  if (address.includes(":")) return !/^(::1$|fc|fd|fe80)/i.test(address);
  return publicIpv4(address);
};

const validCode = (value) => (/^[A-Za-z]{2}$/.test(String(value || "").trim()) ? String(value).trim().toUpperCase() : "");

// ipapi.co answers with a bare country code, which is one less thing to go
// wrong than parsing a geo-IP JSON payload. The second is the fallback.
const providers = (ip) => [
  { url: `https://ipapi.co/${ip}/country/`, read: (text) => validCode(text) },
  { url: `https://ipwho.is/${ip}`, read: (text) => { const data = JSON.parse(text); return data?.success ? validCode(data.country_code) : ""; } },
];

export function createGeoResolver({ fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  const cache = new Map();
  const ttlMs = Math.max(1, env.geo.cacheHours) * 60 * 60 * 1000;

  async function lookup(ip) {
    for (const provider of providers(ip)) {
      try {
        const response = await fetchImpl(provider.url, { headers: { accept: "text/plain, application/json" }, signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) continue;
        const code = provider.read(await response.text());
        if (code) return code;
      } catch { /* try the next provider */ }
    }
    return null;
  }

  return async function resolveCountry(req) {
    if (env.geo.lookup === "off") return null;
    const ip = String(req?.ip || "").trim();
    if (!isRoutable(ip)) return null;
    const now = Date.now();
    const hit = cache.get(ip);
    if (hit && now - hit.at < ttlMs) return hit.code;
    const code = await lookup(ip).catch(() => null);
    if (cache.size > 10000) cache.clear();
    cache.set(ip, { code, at: now });
    return code;
  };
}

export const resolveCountry = createGeoResolver();
