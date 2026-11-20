// Thin CLI for the monthly GitHub workflow. Prints a summary only — never a
// token value. All credentials come from env (Render/CI inject them at runtime).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { flyRotationConfig, rotateFlyToken } from './fly-rotation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(root, '.env') });

const config = flyRotationConfig(process.env);
const summary = await rotateFlyToken(config, {});
console.log(`[fly:rotate] token mới ${summary.newId}, hạn ${summary.expiresOn}; Render env FLY_API_TOKEN đã cập nhật.`);
