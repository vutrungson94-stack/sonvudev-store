// A real server process with the shared test environment, for the gates that
// need a shop to talk to (e2e:check, axe:check). The alternative — each script
// spawning its own server — is how two gates end up disagreeing about the
// environment they measured.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_ENV } from '../../test/helpers/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const adminToken = 'test-admin-token';

export async function startFixtureServer({ port } = {}) {
  const chosenPort = port || 40000 + (process.pid % 10000);
  const baseUrl = `http://127.0.0.1:${chosenPort}`;
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sonvu-fixture-'));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      ...TEST_ENV,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(chosenPort),
      DATA_DIR: dataDir,
      APP_URL: baseUrl,
      ADMIN_API_TOKEN: adminToken,
      ORDER_SWEEP_DISABLED: '1',
      RESEND_API_KEY: '',
      INDEXNOW_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!child.killed) child.kill('SIGKILL');
    await rm(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, port: chosenPort, adminToken, stop, getLog: () => log, child };
}

export async function waitForHealth(baseUrl, adminToken, { attempts = 60, delayMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { 'x-admin-token': adminToken },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}