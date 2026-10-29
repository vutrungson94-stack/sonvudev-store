import { translateMissingKeys } from './src/translate-service.mjs';
const r = await translateMissingKeys('fr');
console.log('fr', JSON.stringify(r));