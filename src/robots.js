// What robots.txt says, written down once.
//
// Both the server and the checker that reads the live site used to carry their own
// copy of the Disallow list, and they had already drifted: /paypal-return was
// disallowed by the server and missing from the checker, so the one tool whose job
// is to notice that the crawler is pointed somewhere private could no longer see
// the rule it exists to verify. Nothing failed. The rule was simply unchecked from
// then on, which is the quietest way a privacy control stops being tested.
//
// A rule that is written twice is a rule that is enforced once. So the list, the
// answer-engine agents and the body are built here, the server sends what this
// module renders, and scripts/seo-check.mjs asserts against the same constants
// against the deployed bytes. Adding a private path is now a one-line change that
// both the response and its check move together.

/**
 * Paths a crawler must not fetch.
 *
 * Each one is private for a stated reason, and the reason is part of the rule
 * because it is what tells the next person whether the path still belongs here:
 *
 *   /admin           the owner's panel; robots.txt is not access control, but
 *                    there is no reason to advertise it
 *   /api/            machine-readable responses, including order lookup
 *   /order/          an order page holds the buyer's access token in its URL,
 *                    so indexing one would publish a working link to their receipt
 *   /lookup          the same page reached from the recovery form
 *   /paypal-return   the PayPal redirect target; it carries an order id in the
 *                    query string for the same reason
 *
 * @type {readonly string[]}
 */
export const ROBOTS_DISALLOW = Object.freeze([
  '/admin',
  '/api/',
  '/order/',
  '/lookup',
  '/paypal-return',
]);

/**
 * Answer engines and AI readers, named one by one rather than left to the default.
 *
 * The default already allowed them, so naming them changes nothing for the major
 * crawlers. What it changes is that the decision is written down instead of
 * implied, and a shop which later wants to opt out of one has the exact block to
 * copy rather than having to work out the name.
 *
 * They are allowed on purpose. Answer engines are where people ask this kind of
 * question now, and a store that hides its catalogue from them is only hiding it
 * from the people looking for it. The names are checked by seo-check.mjs against
 * the live response, so deleting one here is a decision that has to be made here.
 *
 * @type {readonly string[]}
 */
export const AI_CRAWLERS = Object.freeze([
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
]);

/**
 * Builds the robots.txt body.
 *
 * @param {string} appUrl the canonical public origin, without a trailing slash
 * @returns {string} the file body, newline-terminated
 */
export const renderRobotsTxt = (appUrl) => {
  const site = String(appUrl || '').replace(/\/$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    ...ROBOTS_DISALLOW.map((rule) => `Disallow: ${rule}`),
    '',
    ...AI_CRAWLERS.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
};
