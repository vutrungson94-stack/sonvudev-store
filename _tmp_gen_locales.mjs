import { translateMissingKeys } from './src/translate-service.mjs';
for (const lang of ['de', 'es', 'fr']) {
  console.log('Translating', lang, '...');
  const r = await translateMissingKeys(lang);
  console.log(lang, JSON.stringify(r));
  await new Promise(res => setTimeout(res, 1000));
}