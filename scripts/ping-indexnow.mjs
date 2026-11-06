/**
 * Ping IndexNow for all product pages after a content update.
 *
 * Usage: node scripts/ping-indexnow.mjs
 *
 * Reads the live product catalogue from the local data file (or the admin
 * API when SUPABASE_URL is set) and announces every product URL to IndexNow.
 * The host and key come from .env / config.js, so this script does not hardcode
 * any domain or secret.
 */

import { pingIndexNow, isIndexNowConfigured } from '../src/indexnow.js';
import { listProducts } from '../src/store.js';
import { LOCALE_CODES, DEFAULT_LOCALE } from '../src/i18n-registry.mjs';

const main = async () => {
  if (!isIndexNowConfigured()) {
    console.log('[ping-indexnow] Not sent: IndexNow is not configured (INDEXNOW_KEY).');
    return { sent: false, reason: 'unconfigured' };
  }
  const products = await listProducts();
  const paths = new Set(['/']);
  for (const locale of LOCALE_CODES) {
    const base = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
    paths.add(`${base}/`);
    for (const product of products) paths.add(`${base}/product/${product.slug}`);
  }
  const result = await pingIndexNow([...paths]);
  if (result.sent) {
    console.log(`[ping-indexnow] Announced ${result.count} URL(s) to IndexNow.`);
  } else {
    console.log(`[ping-indexnow] Not sent: ${result.reason}`);
  }
  return result;
};

main().catch((error) => {
  console.error('[ping-indexnow] Failed:', error.message);
  process.exit(1);
});
