#!/usr/bin/env node
// Repeatable latency baseline for a running shop.
//
// The repo had gates for correctness and none for speed: a release could make
// every product page twice as slow and the suite would stay green. This script
// is deliberately outside the test suite (it needs a live server and a quiet
// machine) and writes a JSON baseline so two runs can be compared.
//
//   npm start
//   npm run benchmark
//   BASE_URL=https://<domain-cua-ban> npm run benchmark
//   node scripts/benchmark.mjs --requests 300   (khi cần tham số chi tiết)
//
// It measures the routes a buyer actually waits for. The product page is
// discovered from /api/products so the script keeps working when the catalogue
// changes; if no product exists it measures the two universal routes only.
//
// Exit codes: 0 when at least one request succeeded, 1 when every request
// failed (wrong URL, server down, proxy loop), 2 on bad arguments.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULTS = {
  baseUrl: process.env.BASE_URL || 'http://127.0.0.1:3000',
  requests: 200,
  warmup: 20,
  concurrency: 4,
  timeout: 15000,
  out: path.join('build-reports', 'perf-baseline.json'),
  failOnError: false,
};

function usage() {
  console.log(`Usage: node scripts/benchmark.mjs [options]

  --base-url <url>     target origin (default ${DEFAULTS.baseUrl})
  --requests <n>       measured requests per route (default ${DEFAULTS.requests})
  --warmup <n>         discarded requests per route (default ${DEFAULTS.warmup})
  --concurrency <n>    concurrent requests (default ${DEFAULTS.concurrency})
  --routes <a,b>       override the measured paths
  --out <file>         JSON baseline path (default ${DEFAULTS.out})
  --fail-on-error      exit 1 if any measured request failed
  --help               print this text

Environment: BASE_URL is read when --base-url is absent.`);
}

function fail(message) {
  console.error(`benchmark: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, routes: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--base-url': options.baseUrl = next(); break;
      case '--requests': options.requests = Number(next()); break;
      case '--warmup': options.warmup = Number(next()); break;
      case '--concurrency': options.concurrency = Number(next()); break;
      case '--routes': options.routes = next().split(',').map((r) => r.trim()).filter(Boolean); break;
      case '--out': options.out = next(); break;
      case '--timeout': options.timeout = Number(next()); break;
      case '--fail-on-error': options.failOnError = true; break;
      case '-h':
      case '--help': usage(); process.exit(0); break;
      default: fail(`unknown option ${arg}`);
    }
  }
  if (!/^https?:\/\//i.test(options.baseUrl)) fail('--base-url must start with http:// or https://');
  for (const key of ['requests', 'warmup', 'concurrency', 'timeout']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) fail(`--${key} must be a non-negative number`);
  }
  if (options.requests < 1) fail('--requests must be at least 1');
  if (options.concurrency < 1) fail('--concurrency must be at least 1');
  return options;
}

const percentile = (sorted, pct) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
};

const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

async function request(url, timeout) {
  const started = performance.now();
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': 'sonvudev-benchmark/1.0' },
  });
  // The body has to be consumed or the connection is not actually done and the
  // latency reported is time-to-first-byte, not time-to-page.
  await response.arrayBuffer();
  return { ms: performance.now() - started, ok: response.ok, status: response.status };
}

async function measure(url, count, concurrency, timeout) {
  const latencies = [];
  const statuses = new Map();
  let errors = 0;
  let next = 0;
  const started = performance.now();

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= count) return;
      try {
        const result = await request(url, timeout);
        latencies.push(result.ms);
        statuses.set(result.status, (statuses.get(result.status) || 0) + 1);
        if (!result.ok) errors += 1;
      } catch {
        errors += 1;
        latencies.push(timeout);
        statuses.set('network', (statuses.get('network') || 0) + 1);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  const elapsed = performance.now() - started;
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    requests: count,
    errors,
    statuses: Object.fromEntries([...statuses.entries()].sort()),
    minMs: round(sorted[0] ?? null),
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)),
    maxMs: round(sorted[sorted.length - 1] ?? null),
    rps: Math.round((count / (elapsed / 1000)) * 10) / 10,
    elapsedMs: Math.round(elapsed),
  };
}

async function discoverRoutes(baseUrl, timeout) {
  const routes = ['/', '/api/products', '/api/health'];
  try {
    const response = await fetch(new URL('/api/products', baseUrl), {
      signal: AbortSignal.timeout(timeout),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return routes;
    const payload = await response.json();
    const products = Array.isArray(payload) ? payload : payload?.products;
    const slug = Array.isArray(products) ? products.find((p) => p?.slug)?.slug : null;
    if (slug) routes.push(`/product/${encodeURIComponent(slug)}`);
  } catch {
    // The universal routes are still worth measuring; discovery is a bonus.
  }
  return routes;
}

const options = parseArgs(process.argv.slice(2));
let origin;
try {
  origin = new URL(options.baseUrl).origin;
} catch {
  fail(`cannot parse ${options.baseUrl}`);
}

const routes = options.routes || await discoverRoutes(origin, options.timeout);
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: origin,
  node: process.version,
  requests: options.requests,
  warmup: options.warmup,
  concurrency: options.concurrency,
  routes: {},
};

console.log(`Benchmark ${origin} — ${options.requests} requests/route, ${options.concurrency} concurrent, ${options.warmup} warmup`);
console.log('Route                          p50      p95      p99     rps   errors');
console.log('---------------------------------------------------------------------------');

let totalErrors = 0;
let totalRequests = 0;
for (const route of routes) {
  const url = new URL(route, origin).href;
  for (let i = 0; i < options.warmup; i += 1) {
    try { await request(url, options.timeout); } catch { /* warmup failures are not measured */ }
  }
  const result = await measure(url, options.requests, options.concurrency, options.timeout);
  report.routes[route] = result;
  totalErrors += result.errors;
  totalRequests += result.requests;
  const line = [
    route.padEnd(28),
    String(result.p50Ms ?? '-').padStart(7),
    String(result.p95Ms ?? '-').padStart(8),
    String(result.p99Ms ?? '-').padStart(8),
    String(result.rps).padStart(7),
    String(result.errors).padStart(8),
  ].join('');
  console.log(line);
}

await fs.mkdir(path.dirname(options.out), { recursive: true });
await fs.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nBaseline written to ${options.out}`);

if (totalErrors === totalRequests) {
  console.error('Every measured request failed — check BASE_URL and that the server is running.');
  process.exit(1);
}
if (options.failOnError && totalErrors > 0) {
  console.error(`${totalErrors}/${totalRequests} measured requests failed.`);
  process.exit(1);
}
