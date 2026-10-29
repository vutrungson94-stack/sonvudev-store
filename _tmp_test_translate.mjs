import { translateText } from './src/translate-service.mjs';
const texts = [
  'Sản phẩm',
  'Về trang chủ',
  'Điều khoản sử dụng kho phần mềm SonVuDev: phạm vi cấp phép, thanh toán, bảo hành và giới hạn trách nhiệm.',
];
for (const t of texts) {
  try {
    const r = await translateText(t, 'de', 'vi');
    console.log('OK:', t.slice(0,40), '=>', r.slice(0,80));
  } catch (e) {
    console.log('FAIL:', t.slice(0,40), '=>', e.message);
  }
  await new Promise(r=>setTimeout(r,300));
}