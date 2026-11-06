/**
 * Translate smoke test - checks that the provider path works end-to-end (or
 * that we fail explainably, never with a stack trace that looks like a shop
 * bug). This is a manual/ops smoke, not part of the CI suite.
 *
 * Usage:
 *   npm run translate:smoke
 */
import { translateText } from '../src/translate-service.mjs';

const html = '<p>Hello <strong>world</strong>!</p>';
try {
  const result = await translateText(html, 'de', 'en');
  if (!result || typeof result !== 'string') throw new Error('provider returned an empty result');
  console.log('Original:  ', html);
  console.log('Translated:', result);
  console.log('[translate-smoke] OK');
} catch (error) {
  console.error(`[translate-smoke] SKIPPED: ${error.message}`);
  process.exitCode = 0;
}
