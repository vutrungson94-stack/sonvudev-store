import './helpers/env.mjs';
import { createProduct } from '../src/store.js';
const p = await createProduct({ name: 'Test', category: 'Công cụ', platform: 'Windows', version: '1.0.0', price: 99000, currency: 'VND', fileKey: 'products/alert/test.exe', status: 'active' });
console.log(JSON.stringify(p));