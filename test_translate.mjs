import { translateText } from './src/translate-service.mjs';

const html = '<p>Hello <strong>world</strong>!</p>';
try {
  const result = await translateText(html, 'de', 'en');
  console.log('Original:', html);
  console.log('Translated:', result);
} catch (e) {
  console.error('Error:', e.message);
}
