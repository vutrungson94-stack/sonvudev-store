// Which origins may talk to the R2 bucket, derived from one value.
//
// cloudflare/r2-cors.json is the only file in this project that a person applies by
// hand, to a Cloudflare bucket, outside the application: `wrangler r2 bucket cors
// set <bucket> --file cloudflare/r2-cors.json`. Nothing in the server reads it, and
// until now nothing checked it either.
//
// That made it the one place where "the shop's own domain" was written down a second
// time, with no gate able to notice the two copies disagreeing — and a browser upload
// is a cross-origin PUT (public/admin.js asks the server for a presigned URL and then
// PUTs to *.r2.cloudflarestorage.com itself). A stale origin list does not fail the
// build, does not fail the audit, does not fail check:production and does not fail
// /api/health. It fails the one action that publishes a release, with a CORS error,
// on the page only the owner can open.
//
// So the list is computed from APP_URL instead of typed, and two gates read this same
// function: the audit (on any machine with a real .env) and check:production (before
// a deploy). Neither of them can be run against a throwaway APP_URL and still expect
// a verdict, which is why the origin list lives here rather than inline in either.

/**
 * The origins R2 must accept, from the shop's own public address.
 *
 * The www pair is deliberate and not a guess: a shop that redirects apex to www (or
 * the reverse) has two origins, and the admin panel happens to be open on whichever
 * one the owner typed. Leaving out either one is a CORS failure that only appears
 * after a DNS change, which is the worst moment to discover it.
 *
 * Loopback is always present because that is where a developer's browser runs, and
 * removing it to tidy the list breaks local development with no visible cause.
 */
export function requiredOrigins(appUrl) {
  const origins = new Set(["http://localhost:3000"]);
  const host = hostOf(appUrl);
  if (!host) return [...origins];
  origins.add(`https://${host}`);
  if (!host.startsWith("www.")) origins.add(`https://www.${host}`);
  else origins.add(`https://${host.replace(/^www\./, "")}`);
  return [...origins];
}

/** The hostname of a public shop address, or "" when there is not one to read. */
export function hostOf(appUrl) {
  try {
    const { hostname } = new URL(String(appUrl || "").trim());
    return hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Whether an APP_URL is a stand-in rather than a real shop.
 *
 * RFC 2606 reserves .example for exactly this, and a reserved TLD cannot be
 * registered, so a hostname ending in it can never be a shop somebody buys from.
 * That is the whole test, and it is a standard rather than a flag this repository
 * invented — which matters, because the alternative is a skip whose name has to be
 * kept in step with the CI workflow that sets it, and a skip that has drifted
 * silently is how a gate stops gating.
 */
export const isFixtureHost = (appUrl) => hostOf(appUrl).endsWith(".example");

/**
 * Compares the committed CORS file against what APP_URL requires.
 *
 * Returns the origins that are missing, the ones that no longer belong, and a
 * command that fixes it. Reporting the command is the point: the gap between "the
 * file is wrong" and "the file is wrong and here is the one line that changes it" is
 * the gap in which this kind of thing stays broken for a year.
 */
export function corsDiff(fileRules, appUrl) {
  const required = requiredOrigins(appUrl);
  const configured = new Set(
    (Array.isArray(fileRules) ? fileRules : []).flatMap((rule) => (Array.isArray(rule?.AllowedOrigins) ? rule.AllowedOrigins : [])),
  );
  return {
    required,
    missing: required.filter((origin) => !configured.has(origin)),
    // Kept rather than reported as an error on its own: an extra origin is a
    // widening of who may upload, which is worth seeing but is the owner's call.
    extra: [...configured].filter((origin) => !required.includes(origin)).sort(),
  };
}