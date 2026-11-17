// Turn edge access data into the three SLO evidence files.
//
// The SLO monitor (scripts/slo-monitor.mjs) reads:
//   logs/last-availability.json  -> availability (%)
//   logs/last-error-report.json  -> errorRate (%)
//   logs/last-latency.json       -> p95Seconds
// Until those files exist, availability/errorRate/latencyP95 are "unknown" and
// the SLO gate cannot say anything. This script fills them from a real source —
// Render's metrics API, Render's app log, or an access-log export — never a
// synthetic probe and never a hand-edited number.
//
//   # Render metrics (paid plan; free plan returns empty/plan errors)
//   RENDER_API_KEY, RENDER_SERVICE_ID
//   node scripts/slo-ingest.mjs                 # 30-day window, write evidence
//   node scripts/slo-ingest.mjs --dry-run       # print, write nothing
//   node scripts/slo-ingest.mjs --days=7
//
//   # Render app logs (works on the free plan: request-log stream is empty,
//   # but the server's own request lines are in the app log)
//   node scripts/slo-ingest.mjs --render-logs
//   node scripts/slo-ingest.mjs --render-logs --pages=30 --dry-run
//   node scripts/slo-ingest.mjs --render-logs --include-health
//
//   # Cloudflare GraphQL Analytics (real 30-day edge traffic; needs
//   # CLOUDFLARE_API_TOKEN with Account Analytics: Read — httpRequests* are
//   # account-scoped datasets — and CLOUDFLARE_ZONE_ID. Zone Analytics: Read
//   # alone returns an empty list, which this script refuses to record.)
//   node scripts/slo-ingest.mjs --cloudflare
//   node scripts/slo-ingest.mjs --cloudflare --allow-empty   # window truly had 0 requests
//
//   # External access-log export (Cloudflare/uptime/Render log dump)
//   node scripts/slo-ingest.mjs --file=logs/access-30d.json
//
// Accepted file shape: a JSON array, or { entries|logs|data: [...] }. Each
// record may carry status|statusCode|status_code, latencyMs|durationMs|latency|
// duration, and timestamp|time. latencyMs/durationMs are milliseconds; latency/
// duration are seconds (the SLO unit).
//
// Method, stated because it is not the only possible one:
//   availability  (all requests - 5xx) / all requests
//   errorRate     5xx / all requests
//   latencyP95    p95 of request durations from raw records/app logs. For the
//                 metrics API (percentile series only) the max p95 over the
//                 window is used, because a true p95 cannot be reconstructed
//                 from percentiles. The evidence file names which method ran.
// If request counts have no status-code label, availability and error rate are
// written as null and the SLO stays unknown rather than inventing a rate.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.render.com/v1';

const argValue = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

export function isServerError(status) {
  const text = String(status ?? '').trim().toLowerCase();
  if (!text) return false;
  if (text === '5xx' || text.startsWith('5')) return true;
  const code = Number.parseInt(text, 10);
  return Number.isFinite(code) && code >= 500 && code < 600;
}

export function statusOfSeries(series) {
  for (const label of series?.labels || []) {
    if (['statusCode', 'status', 'code', 'status_code'].includes(label.field)) {
      return String(label.value);
    }
  }
  return null;
}

export function sumRequests(series) {
  let total = 0;
  let serverErrors = 0;
  let unknown = 0;
  for (const entry of series) {
    const status = statusOfSeries(entry);
    const sum = (entry.values || []).reduce((acc, point) => acc + Number(point.value || 0), 0);
    total += sum;
    if (!status) unknown += sum;
    else if (isServerError(status)) serverErrors += sum;
  }
  return { total, serverErrors, unknown };
}

export function toSeconds(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').trim().toLowerCase();
  if (['ms', 'millisecond', 'milliseconds'].includes(u)) return n / 1000;
  if (['us', 'µs', 'microsecond', 'microseconds'].includes(u)) return n / 1_000_000;
  if (['ns', 'nanosecond', 'nanoseconds'].includes(u)) return n / 1_000_000_000;
  // Render's latency series is documented in seconds; an absent unit means the
  // same thing. Anything else is passed through unchanged and reported in the
  // dry-run so a wrong unit is visible rather than silently scaled.
  return n;
}

export function latencyP95(series) {
  const points = [];
  const units = new Set();
  for (const entry of series) {
    const unit = entry.unit || entry.values?.[0]?.unit || '';
    units.add(String(unit || 'unknown'));
    for (const point of entry.values || []) {
      const seconds = toSeconds(point.value, unit);
      if (seconds != null) points.push(seconds);
    }
  }
  if (points.length === 0) return { p95Seconds: null, points: 0, units: [...units] };
  points.sort((a, b) => a - b);
  return { p95Seconds: points[points.length - 1], points: points.length, units: [...units] };
}

export function summarizeRecords(records, days = 30) {
  // External export path. Accepted record fields:
  //   status | statusCode | status_code
  //   latencyMs | durationMs | latency | duration   (first two are milliseconds,
  //   the last two are assumed seconds — the SLO unit)
  //   timestamp | time (ISO; records without one are included)
  const cutoff = Date.now() - days * 86400000;
  let total = 0;
  let serverErrors = 0;
  let unknown = 0;
  const latencies = [];
  for (const record of records) {
    const timestamp = Date.parse(record.timestamp || record.time || '');
    if (Number.isFinite(timestamp) && timestamp < cutoff) continue;
    total += 1;
    const status = record.status ?? record.statusCode ?? record.status_code ?? null;
    if (status == null) unknown += 1;
    else if (isServerError(status)) serverErrors += 1;
    const raw = record.latencyMs ?? record.durationMs ?? record.latency ?? record.duration ?? null;
    if (raw != null && Number.isFinite(Number(raw))) {
      const value = Number(raw);
      const inMs = record.latencyMs != null || record.durationMs != null;
      latencies.push(inMs ? value / 1000 : value);
    }
  }
  latencies.sort((a, b) => a - b);
  const p95Index = latencies.length > 0 ? Math.ceil(latencies.length * 0.95) - 1 : -1;
  return {
    total,
    serverErrors,
    unknown,
    availability: total > 0 && unknown === 0 ? ((total - serverErrors) / total) * 100 : null,
    errorRate: total > 0 && unknown === 0 ? (serverErrors / total) * 100 : null,
    p95Seconds: p95Index >= 0 ? latencies[p95Index] : null,
    maxSeconds: latencies.length > 0 ? latencies[latencies.length - 1] : null,
    latencyPoints: latencies.length,
  };
}

const fetchSeries = async (apiKey, serviceId, query) => {
  // `query` already starts with `http-requests?...`, so the resource filter
  // joins with `&`. The first draft used `?resource=` and Render answered
  // "aggregateBy has invalid value: statusCode?resource=srv-..." — a 400 that
  // looks like a bad filter but is a second question mark.
  const separator = query.includes('?') ? '&' : '?';
  const url = `${API}/metrics/${query}${separator}resource=${encodeURIComponent(serviceId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${query}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  return Array.isArray(body) ? body : (body.series || body.items || []);
};

// Cloudflare GraphQL returns status groups shaped:
//   [{ count, dimensions: { edgeResponseStatus: "503" } }, ...]
// Convert them with the same 5xx rule as every other source. A group without a
// status label is counted as unknown so availability stays honest (null), never 0.
export function cloudflareGroupsToSummary(groups) {
  let total = 0;
  let serverErrors = 0;
  let unknown = 0;
  for (const group of groups || []) {
    const count = Number(group?.count || 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    total += count;
    const status = group?.dimensions?.edgeResponseStatus ?? group?.dimensions?.clientResponseStatus ?? null;
    if (status == null) unknown += count;
    else if (isServerError(status)) serverErrors += count;
  }
  return {
    total,
    serverErrors,
    unknown,
    availability: total > 0 && unknown === 0 ? ((total - serverErrors) / total) * 100 : null,
    errorRate: total > 0 && unknown === 0 ? (serverErrors / total) * 100 : null,
  };
}

/**
 * The operator-facing explanation for a zero-row Cloudflare answer.
 *
 * `httpRequests*` are **account-scoped** datasets: a token that holds only the
 * zone permission (`Zone → Analytics → Read`) can call the node and receive an
 * empty list, while the same query under `viewer.accounts` answers "not
 * authorized for that account". The zone's `settings { httpRequestsAdaptiveGroups
 * { enabled notOlderThan } }` still reports the dataset enabled and 31 days of
 * retention, so nothing in the zone configuration points at the cause.
 *
 * A zero here is a source that could not be read, not a measurement of a quiet
 * month. The CLI refuses to write it over real evidence unless the operator says
 * the window truly had no requests (`--allow-empty`).
 */
export function cloudflareEmptyDiagnostic(summary, days) {
  if (!summary || Number(summary.total) > 0) return null;
  return `Cloudflare trả 0 request trong ${days} ngày. httpRequests* là dataset cấp ACCOUNT: `
    + 'token cần "Account → Account Analytics → Read" (chỉ "Zone → Analytics → Read" thì node '
    + 'trả danh sách rỗng, còn truy vấn account-level báo "not authorized for that account"). '
    + 'Nếu cửa sổ thật sự không có request thì chạy lại với --allow-empty.';
}

// The five-minute bucket a group starts at covers that whole bucket, so the last
// non-empty bucket ends five minutes after its timestamp. Without this the
// reported window stops at the start of the last observed interval.
export function cloudflareObservedRange(earliest, latest) {
  const fromMs = earliest ? Date.parse(earliest) : Number.NaN;
  const toMs = latest ? Date.parse(latest) : Number.NaN;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { observedFrom: null, observedTo: null, coverageDays: 0 };
  }
  const start = Math.min(fromMs, toMs);
  const end = Math.max(fromMs, toMs) + 300_000;
  return {
    observedFrom: new Date(start).toISOString(),
    observedTo: new Date(end).toISOString(),
    coverageDays: (end - start) / 86400000,
  };
}

const cloudflareGraphql = async (token, query, variables) => {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  const zones = body?.data?.viewer?.zones || [];
  if (!zones.length) throw new Error('zone not found in Cloudflare Analytics (check CLOUDFLARE_ZONE_ID)');
  return zones[0];
};

// Returns the status summary AND the real observation span.
//
// `httpRequestsAdaptiveGroups` only returns buckets that carry requests. When the
// edge was switched on partway through the requested month (CNAME/proxied DNS
// change, or an account token that previously could not read the dataset), the
// oldest bucket is not the start of the requested window, and claiming a full
// 30-day measurement would be false. Two limit-1 queries give the first and last
// non-empty five-minute buckets, so coverage is measured instead of assumed.
const fetchCloudflareGroups = async (token, zoneId, { days }) => {
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const end = new Date().toISOString();
  const variables = { zone: zoneId, start, end };
  const groupsQuery = `query SloGroups($zone: String!, $start: Time!, $end: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequestsAdaptiveGroups(
        limit: 1000
        filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
        orderBy: [date_ASC]
      ) { count dimensions { date edgeResponseStatus } }
    } }
  }`;
  const boundsQuery = (order) => `query SloBounds($zone: String!, $start: Time!, $end: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequestsAdaptiveGroups(
        limit: 1
        filter: { datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball" }
        orderBy: [datetimeFiveMinutes_${order}]
      ) { count dimensions { datetimeFiveMinutes } }
    } }
  }`;
  const node = await cloudflareGraphql(token, groupsQuery, variables);
  const earliest = await cloudflareGraphql(token, boundsQuery('ASC'), variables);
  const latest = await cloudflareGraphql(token, boundsQuery('DESC'), variables);
  const firstBucket = earliest.httpRequestsAdaptiveGroups?.[0]?.dimensions?.datetimeFiveMinutes ?? null;
  const lastBucket = latest.httpRequestsAdaptiveGroups?.[0]?.dimensions?.datetimeFiveMinutes ?? null;
  return {
    groups: node.httpRequestsAdaptiveGroups || [],
    ...cloudflareObservedRange(firstBucket, lastBucket),
  };
};

const fetchJson = async (url, apiKey) => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${String(url)}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
};

const getOwnerId = async (apiKey, serviceId) => {
  const body = await fetchJson(`${API}/services/${encodeURIComponent(serviceId)}`, apiKey);
  const service = body.service || body;
  if (!service.ownerId) throw new Error('service response has no ownerId');
  return service.ownerId;
};

// Render's request-log stream is empty on the free plan, but the app's own
// request lines are in the app log. The server writes one line per request:
//   <uuid> trace=<trace> 200 GET /api/health 153.9ms
// Parsing those gives the same three measurements without a paid metrics plan.
// /api/health is excluded by default: it is a synthetic probe and would
// dominate both the request count and the latency of a quiet shop.
const fetchAppLogRecords = async (apiKey, ownerId, serviceId, { days, pagesLimit, includeHealth }) => {
  let start = new Date(Date.now() - days * 86400000).toISOString();
  let end = new Date().toISOString();
  const records = [];
  let pagesFetched = 0;
  let hasMore = false;
  while (pagesFetched < pagesLimit) {
    const url = new URL(`${API}/logs`);
    url.searchParams.set('ownerId', ownerId);
    url.searchParams.append('resource', serviceId);
    url.searchParams.set('startTime', start);
    url.searchParams.set('endTime', end);
    url.searchParams.set('type', 'app');
    url.searchParams.set('limit', '100');
    url.searchParams.set('direction', 'backward');
    const body = await fetchJson(url, apiKey);
    pagesFetched += 1;
    for (const log of body.logs || []) {
      const match = /^\S+\s+trace=\S+\s+(\d{3})\s+[A-Z]+\s+(\S+)\s+([\d.]+)ms/.exec(String(log.message || ''));
      if (!match) continue;
      const [, status, pathName, durationMs] = match;
      if (!includeHealth && pathName === '/api/health') continue;
      records.push({
        timestamp: log.timestamp,
        status: Number(status),
        latencyMs: Number(durationMs),
        path: pathName,
      });
    }
    hasMore = Boolean(body.hasMore);
    if (!hasMore) break;
    if (!body.nextStartTime || !body.nextEndTime) break;
    if (body.nextStartTime === start && body.nextEndTime === end) break;
    start = body.nextStartTime;
    end = body.nextEndTime;
  }
  return { records, pagesFetched, hasMore };
};

export async function main() {
  dotenv.config({ path: path.join(root, '.env'), override: true });
  const days = Number(argValue('days', '30'));
  if (!Number.isFinite(days) || days <= 0) {
    console.error('[slo:ingest] --days phải là số dương.');
    process.exit(2);
  }
  const dryRun = hasFlag('dry-run');
  const file = argValue('file', '').trim();
  const cloudflare = hasFlag('cloudflare');
  const renderLogs = hasFlag('render-logs');
  const pagesLimit = Number(argValue('pages', '20'));
  const includeHealth = hasFlag('include-health');
  if (!Number.isFinite(pagesLimit) || pagesLimit <= 0) {
    console.error('[slo:ingest] --pages phải là số nguyên dương.');
    process.exit(2);
  }
  const apiKey = (process.env.RENDER_API_KEY || '').trim();
  const serviceId = (argValue('service', process.env.RENDER_SERVICE_ID || '')).trim();
  const quantile = Number(argValue('quantile', '0.95'));
  const now = new Date().toISOString();

  let total;
  let serverErrors;
  let unknown;
  let availability;
  let errorRate;
  let latencyResult;
  let source;
  let latencyMethod;
  let sampled = false;
  let pagesFetched = 0;
  let observedFrom = null;
  let observedTo = null;
  let coverageDays = 0;
  let coverageMethod = 'requested window';

  if (cloudflare) {
    const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
    const zoneId = (process.env.CLOUDFLARE_ZONE_ID || '').trim();
    if (!token || !zoneId) {
      console.error('[slo:ingest] --cloudflare cần CLOUDFLARE_API_TOKEN (Account → Account Analytics: Read) và CLOUDFLARE_ZONE_ID.');
      process.exit(2);
    }
    const cf = await fetchCloudflareGroups(token, zoneId, { days });
    const groups = cf.groups;
    const summary = cloudflareGroupsToSummary(groups);
    if (summary.total === 0 && !hasFlag('allow-empty')) {
      // Refuse rather than write null evidence: a previous real availability
      // would be erased, and the SLO would look "unknown" for a permission bug
      // instead of reporting it. --allow-empty is the explicit opt-in for a
      // window that genuinely had no traffic.
      console.error(`[slo:ingest] ${cloudflareEmptyDiagnostic(summary, days)}`);
      console.error('[slo:ingest] Không ghi evidence: 0 dòng ở đây là lỗi nguồn, không phải phép đo.');
      process.exit(2);
    }
    total = summary.total;
    serverErrors = summary.serverErrors;
    unknown = summary.unknown;
    availability = summary.availability;
    errorRate = summary.errorRate;
    // Cloudflare's adaptive groups do not carry a usable p95 latency series;
    // latency stays unknown rather than inventing a number. Keep any earlier
    // measured latency only when it came from a real source.
    latencyResult = { p95Seconds: null, points: 0, units: [], reason: 'Cloudflare adaptive groups have no p95 latency dimension' };
    source = `Cloudflare GraphQL Analytics (httpRequestsAdaptiveGroups, ${days}d, requestSource=eyeball)`;
    latencyMethod = 'unknown — Cloudflare groups expose counts, not p95 latency';
    // Coverage comes from the buckets that actually returned rows, not from the
    // requested window. A month-long window with data only since the edge was
    // switched on must say so; otherwise a 20-minute sample is filed as a
    // 30-day SLO and reads as a month of evidence.
    coverageDays = total > 0 ? cf.coverageDays : 0;
    observedFrom = cf.observedFrom;
    observedTo = cf.observedTo;
    coverageMethod = 'first/last non-empty five-minute bucket (httpRequestsAdaptiveGroups)';
  } else if (file) {
    const body = JSON.parse(await readFile(path.resolve(root, file), 'utf8'));
    const records = Array.isArray(body) ? body : (body.entries || body.logs || body.data || []);
    const summary = summarizeRecords(records, days);
    total = summary.total;
    serverErrors = summary.serverErrors;
    unknown = summary.unknown;
    availability = summary.availability;
    errorRate = summary.errorRate;
    latencyResult = {
      p95Seconds: summary.p95Seconds,
      points: summary.latencyPoints,
      units: ['s'],
      reason: null,
    };
    source = `file:${file}`;
    latencyMethod = 'p95 from file records (latencyMs/durationMs → seconds)';
    const fileTimes = records
      .map((record) => Date.parse(record.timestamp || record.time || ''))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    observedFrom = fileTimes.length > 0 ? new Date(fileTimes[0]).toISOString() : null;
    observedTo = fileTimes.length > 0 ? new Date(fileTimes[fileTimes.length - 1]).toISOString() : null;
    coverageDays = observedFrom && observedTo
      ? (Date.parse(observedTo) - Date.parse(observedFrom)) / 86400000
      : 0;
    coverageMethod = 'min/max timestamp in the export';
  } else if (renderLogs) {
    const missing = [];
    if (!apiKey) missing.push('RENDER_API_KEY');
    if (!serviceId) missing.push('RENDER_SERVICE_ID');
    if (missing.length) {
      console.error(`[slo:ingest] Thiếu env vars: ${missing.join(', ')} (hoặc dùng --file=<export.json>)`);
      process.exit(2);
    }
    const ownerId = await getOwnerId(apiKey, serviceId);
    const logResult = await fetchAppLogRecords(apiKey, ownerId, serviceId, {
      days,
      pagesLimit,
      includeHealth,
    });
    const summary = summarizeRecords(logResult.records, days);
    total = summary.total;
    serverErrors = summary.serverErrors;
    unknown = summary.unknown;
    availability = summary.availability;
    errorRate = summary.errorRate;
    latencyResult = {
      p95Seconds: summary.p95Seconds,
      points: summary.latencyPoints,
      units: ['s'],
      reason: summary.total === 0 ? 'no request lines in Render app logs for the window' : null,
    };
    source = 'Render app logs (request lines)';
    latencyMethod = `p95 of request durations parsed from app logs; /api/health ${includeHealth ? 'included' : 'excluded'}`;
    sampled = logResult.hasMore;
    pagesFetched = logResult.pagesFetched;
    const times = logResult.records
      .map((record) => Date.parse(record.timestamp))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    observedFrom = times.length > 0 ? new Date(times[0]).toISOString() : null;
    observedTo = times.length > 0 ? new Date(times[times.length - 1]).toISOString() : null;
    coverageDays = observedFrom && observedTo
      ? (Date.parse(observedTo) - Date.parse(observedFrom)) / 86400000
      : 0;
    coverageMethod = 'min/max request-line timestamp in the app log';
  } else {
    const missing = [];
    if (!apiKey) missing.push('RENDER_API_KEY');
    if (!serviceId) missing.push('RENDER_SERVICE_ID');
    if (missing.length) {
      console.error(`[slo:ingest] Thiếu env vars: ${missing.join(', ')} (hoặc dùng --file=<export.json>)`);
      process.exit(2);
    }
    const resolution = Number(argValue('resolution', '3600'));
    const latencyResolution = Number(argValue('latency-resolution', '86400'));
    const start = new Date(Date.now() - days * 86400000).toISOString();
    const end = now;

    const requests = await fetchSeries(
      apiKey,
      serviceId,
      `http-requests?startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}&resolutionSeconds=${resolution}&aggregateBy=statusCode`,
    );
    // The latency endpoint is a paid-plan query on Render ("query is not allowed
    // for plan: Hobby"). That is a real limit of the source, not a script bug:
    // availability/errorRate still come from the request-count endpoint, and
    // latency stays unknown with the reason recorded rather than a guessed number.
    let latency = [];
    let latencyError = null;
    try {
      latency = await fetchSeries(
        apiKey,
        serviceId,
        `http-latency?startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}&resolutionSeconds=${latencyResolution}&quantile=${quantile}`,
      );
    } catch (error) {
      latencyError = error.message;
      console.log(`[slo:ingest] latency unavailable: ${latencyError}`);
    }

    const requestSummary = sumRequests(requests);
    total = requestSummary.total;
    serverErrors = requestSummary.serverErrors;
    unknown = requestSummary.unknown;
    availability = total > 0 && unknown === 0 ? ((total - serverErrors) / total) * 100 : null;
    errorRate = total > 0 && unknown === 0 ? (serverErrors / total) * 100 : null;
    coverageDays = total > 0 ? days : 0;
    latencyResult = latencyError
      ? { p95Seconds: null, points: 0, units: [], reason: latencyError }
      : latencyP95(latency);
    source = 'Render metrics API (http-requests aggregateBy=statusCode / http-latency)';
    latencyMethod = `max of Render p${(quantile * 100).toFixed(0)} series over the window (conservative)`;
  }

  console.log(
    `[slo:ingest] window=${days}d source=${source} requests=${total} serverErrors=${serverErrors} unknownStatus=${unknown} sampled=${sampled} pages=${pagesFetched} coverage=${coverageDays.toFixed(3)}d observed=${observedFrom || '?'}..${observedTo || '?'}`,
  );
  console.log(
    `[slo:ingest] availability=${availability == null ? 'unknown' : availability.toFixed(2) + '%'} `
    + `errorRate=${errorRate == null ? 'unknown' : errorRate.toFixed(2) + '%'} `
    + `p95=${latencyResult.p95Seconds == null ? 'unknown' : latencyResult.p95Seconds.toFixed(3) + 's'} `
    + `latencyPoints=${latencyResult.points} units=${latencyResult.units.join(',') || 'none'}`,
  );
  if (unknown > 0) {
    console.log('[slo:ingest] WARNING: some requests have no status code — availability/errorRate stay unknown rather than being guessed.');
  }
  if (dryRun) {
    console.log('[slo:ingest] --dry-run: không ghi file.');
    return;
  }

  await mkdir(path.join(root, 'logs'), { recursive: true });
  await writeFile(
    path.join(root, 'logs', 'last-availability.json'),
    JSON.stringify({
      availability: availability == null ? null : Number(availability.toFixed(4)),
      samples: total,
      windowDays: days,
      generatedAt: now,
      source,
      method: '5xx / all requests; 5xx counted as unavailable',
      unknownStatusSamples: unknown,
      sampled,
      pagesFetched,
      observedFrom,
      observedTo,
      coverageDays,
      coverageMethod,
    }, null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'logs', 'last-error-report.json'),
    JSON.stringify({
      errorRate: errorRate == null ? null : Number(errorRate.toFixed(4)),
      serverErrors,
      samples: total,
      windowDays: days,
      generatedAt: now,
      source,
      method: 'server errors (5xx) / all requests',
      sampled,
      pagesFetched,
      observedFrom,
      observedTo,
      coverageDays,
      coverageMethod,
    }, null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    path.join(root, 'logs', 'last-latency.json'),
    JSON.stringify({
      p95Seconds: latencyResult.p95Seconds == null ? null : Number(latencyResult.p95Seconds.toFixed(6)),
      samples: latencyResult.points,
      windowDays: days,
      generatedAt: now,
      source,
      method: latencyMethod,
      units: latencyResult.units,
      reason: latencyResult.reason || null,
      sampled,
      pagesFetched,
      observedFrom,
      observedTo,
      coverageDays,
      coverageMethod,
    }, null, 2) + '\n',
    'utf8',
  );
  console.log('[slo:ingest] đã ghi logs/last-availability.json, last-error-report.json, last-latency.json');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[slo:ingest] ${error.message}`);
    process.exit(1);
  });
}