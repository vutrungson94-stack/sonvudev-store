# Change plan — 2026-11-20 restore compressed HTML without losing the JSD fix

```yaml
rev: 1
task: "Serve gzip public HTML from the origin and keep it compressed through the origin-balancer Worker, while keeping no-transform (no JSD injection) and correct Vary caching"

scope:
  - file: src/app.js
    region: "zlib import + shared sendHtml helper used by sendPage, notFound, productPage, blogPage, blogIndexPage, product 500 fallback; PUBLIC_PAGE_CACHE unchanged"
  - file: cloudflare/origin-balancer/worker.js
    region: "withHeader (safe Response rebuild), upstreamHeaders (Accept-Encoding: identity), acceptsGzip, gzipHtmlResponse, CACHE_VERSION marker, stale entry construction, upstream fetch + post-fetch compression"
  - file: test/html-cache.test.js
    region: "raw-HTTP tests for gzip/Vary on public HTML and identity response"
  - file: test/origin-balancer.test.js
    region: "tests for acceptsGzip, upstreamHeaders, gzipHtmlResponse body/headers, withHeader encoded-body preservation"
  - file: WORKFLOW.md
    region: "one new pre-sync invariant bullet for the gzip/worker encoding contract"
  - file: docs/CHANGE-PLAN-2026-11-20-ORIGIN-GZIP.md
    region: "this plan"

why: |
  After the no-transform change live HTML is 115 KB uncompressed for every
  Accept-Encoding value, and Lighthouse reports "No compression applied" (~75 KB).
  BP is 100 and lab Perf 99, so this is about real visitor bandwidth, not score.
  Cloudflare Workers fetch() transparently decompresses gzip and strips
  Content-Encoding; a naive Worker wrapper that rebuilds a Response from a plain
  object init also drops workerd's write-only `encodeBody: "manual"` flag and
  double-encodes the body (workerd#7066). Both failure modes must be designed out.

design:
  - "Origin: gzipSync only when Accept-Encoding contains gzip; Vary: Accept-Encoding on every public HTML response; Cache-Control keeps no-transform"
  - "Worker asks the origin with Accept-Encoding: identity, so it can never receive compressed upstream bytes to decompress"
  - "Worker compresses the final HTML itself with CompressionStream('gzip') and returns it with encodeBody: 'manual' + Content-Encoding: gzip + Vary"
  - "withHeader rebuilds with new Response(body, response) then headers.set — the only shape that preserves the encodeBody flag (workerd#7066)"
  - "stale cache entry is built with the same safe helper, not a plain object init"
  - "Worker cache entries carry X-SVD-Cache-V = gzip-20261120; pre-change unversioned entries are ignored so the gzip fix takes effect without waiting out the one-day TTL"
  - "no new dependency: node:zlib on the origin, Web Streams in the Worker"

invariants_checked:
  - "CSP nonce still fresh per response (no-transform and gzip do not touch it)"
  - "PUBLIC_PAGE_CACHE still carries max-age=86400 + stale-if-error + no-transform"
  - "API/admin paths still no-store and are never gzipped here"
  - "stale failover still serves a 200 with Warning:110 and the right encoding"
  - "no WAF/secret/Cloudflare dashboard change"

tests:
  - "raw HTTP GET / with Accept-Encoding: gzip → 200, content-encoding gzip, vary accept-encoding, gunzip(body) contains the SSR homepage"
  - "raw HTTP GET / with Accept-Encoding: identity → 200, no content-encoding, same HTML"
  - "acceptsGzip / upstreamHeaders / gzipHtmlResponse exported pure helpers"
  - "withHeader adds a header to an already-encoded Response without changing the wire body"

risk: |
  If encodeBody manual were lost the browser would receive double-encoded bytes;
  the safe rebuild shape and the raw-body test pin that. If Workers still rewrites
  the body at the edge, live probe will show it and the Worker gzip can be backed
  out without touching BP/no-transform.

verification:
  - "all repo gates + _Tests gtest green; _Sync auto-commit/push"
  - "after deploy: raw probe shows content-encoding gzip and ~26 KB for gzip clients, 115 KB for identity"
  - "live Lighthouse: best-practices >= 90, performance >= 85, deprecations score 1"
  - "/api/health commit equals github.sha; edge cf-cache-status HIT after warm-up"

rollback: "revert the two source files and let _Sync push; no-transform/JSD fix stays intact"
```

## Kết quả đo sau deploy (2026-11-20 / 21)

```yaml
commit_origin: 5018a75          # CI run 44714266243 xanh, deployed-site purge edge + 212/212 SEO
worker_version: 919eed08-8130-4463-aa34-edb1b8117250
live_raw_probe:
  - { accept: "gzip, deflate, br", encoding: br,   wire_bytes: 27989,  decoded_html: true, jsd: false, cache: HIT }
  - { accept: "gzip",             encoding: gzip, wire_bytes: 26082,  decoded_html: true, jsd: false, cache: HIT }
  - { accept: "identity",         encoding: "-",   wire_bytes: 115035, decoded_html: true, jsd: false, cache: HIT }
compression_saving: "~77% (115.0 KB -> 26.1 KB gzip / 28.0 KB brotli)"
live_lighthouse: { performance: 99, best_practices: 100, deprecations_score: 1 }
observation: "Trong lúc Worker vừa deploy có vài request trả 500/error 1101 trong ~1 phút (propagation); mọi request sau đó đều 200, không lặp lại."
unrelated_note: "/api/health trên Fly trả commit sha không khớp HEAD local (99a01752 / f71f5a15) dù CI deployed-site xanh và SEO/minified-JS khớp artifact. Cần điều tra riêng nếu muốn dùng health sha làm bằng chứng deploy."
```
