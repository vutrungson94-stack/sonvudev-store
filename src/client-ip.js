// The address the shop rate-limits and geo-locates.
//
// Cloudflare sets CF-Connecting-IP on every proxied request and keeps it on the
// Worker's outbound fetch; the X-Forwarded-For a Worker sets is stripped at the
// edge. Once the origin balancer is in front, Express's req.ip therefore names
// the Worker, not the buyer — one shared rate-limit bucket and a country lookup
// for the wrong address. Prefer the edge header, and fall back to req.ip for a
// direct/local request that has no edge in front of it.

const looksLikeIp = (value) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value)
  || (value.includes(":") && /^[0-9a-f:]+$/i.test(value));

export const clientIp = (req) => {
  const header = String(req?.headers?.["cf-connecting-ip"] || "").split(",")[0].trim();
  if (looksLikeIp(header)) return header;
  return String(req?.ip || "").trim();
};
