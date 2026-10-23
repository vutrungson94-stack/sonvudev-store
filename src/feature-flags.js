// Feature flags, read from the environment.
//
// A host can turn a capability on or off without a redeploy or a code change:
// FEATURE_<NAME>=1 enables it, anything else (or absence) disables it. Defaults
// are conservative (off) so a feature is never accidentally live.
//
// Flags are intentionally not cached: the cost of reading process.env is
// negligible, and a flag flipped in the host environment must take effect on the
// next request rather than after a process restart.
const truthy = /^(1|true|yes|on)$/i;

export function isEnabled(name, fallback = false) {
  const key = `FEATURE_${String(name || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === "") return Boolean(fallback);
  return truthy.test(String(raw).trim());
}

export function allFlags() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("FEATURE_")) continue;
    out[key.slice("FEATURE_".length).toLowerCase()] = truthy.test(String(value).trim());
  }
  return out;
}
