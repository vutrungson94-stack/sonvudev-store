## Service availability `availability` (target 99.5 %, want up) — trạng thái: **n=1**

```
  100  ✓
```

- 2026-11-17: 100 (ok) — logs/last-availability.json — edge request window from the configured source (windowDays/coverageDays recorded in the file)

---

## API error rate `errorRate` (target 1 %, want down) — trạng thái: **n=1**

```
    0  ✓
```

- 2026-11-17: 0 (ok) — logs/last-error-report.json

---

## API p95 latency `latencyP95` (target 400 ms, want down) — trạng thái: **n=1**

```
  238  ✓
```

- 2026-11-17: 238 (ok) — logs/last-latency.json (p95Seconds, converted to milliseconds)

---

## Test suite pass rate `testPassRate` (target 100 %, want up) — trạng thái: **n=1**

```
  100  ✓
```

- 2026-11-17: 100 (ok) — test_output.log

---

## Build success rate `buildSuccessRate` (target 100 %, want up) — trạng thái: **n=1**

```
  100  ✓
```

- 2026-11-17: 100 (ok) — build-reports/web-build.json — the outcome of the last build, not a rate

---

## Deploy success rate `deploySuccessRate` (target 100 %, want up) — trạng thái: **4/4 ok**

```
    0  ✓
  100                                      ✓
  100                                      ✓
  100                                      ✓
```

- 2026-11-04: 0 (ok) — metrics-dora-history.json (deploymentFrequency)
- 2026-11-10: 100 (ok) — metrics-dora-history.json (deploymentFrequency)
- 2026-11-14: 100 (ok) — metrics-dora-history.json (deploymentFrequency)
- 2026-11-16: 100 (ok) — metrics-dora-history.json (deploymentFrequency)

### Cửa sổ thiếu (không được tự đoán mức độ bị ảnh hưởng)
- 2026-11-04 -> 2026-11-10: giữa đó thiếu ~5 ngày — không tự đoán bị ảnh hưởng, chạy lại ingest khi có dữ liệu: npm run slo:ingest / npm run slo:timeline
- 2026-11-10 -> 2026-11-14: giữa đó thiếu ~3 ngày — không tự đoán bị ảnh hưởng, chạy lại ingest khi có dữ liệu: npm run slo:ingest / npm run slo:timeline

---

## Escaped defect rate `escapeRate` (target 5 %, want down) — trạng thái: **5/5 ok**

```
    0  ✓
    0  ✓
    0  ✓
   11                          ✓
   16                                     ✓
```

- 2026-11-04: 0 (ok) — metrics-dora-history.json (changeFailureRate)
- 2026-11-09: 0 (ok) — metrics-defect-escape.json (metrics-trends.json)
- 2026-11-10: 0 (ok) — metrics-dora-history.json (changeFailureRate)
- 2026-11-14: 11 (ok) — metrics-dora-history.json (changeFailureRate)
- 2026-11-16: 16 (ok) — metrics-dora-history.json (changeFailureRate)

### Cửa sổ thiếu (không được tự đoán mức độ bị ảnh hưởng)
- 2026-11-04 -> 2026-11-09: giữa đó thiếu ~4 ngày — không tự đoán bị ảnh hưởng, chạy lại ingest khi có dữ liệu: npm run slo:ingest / npm run slo:timeline
- 2026-11-10 -> 2026-11-14: giữa đó thiếu ~3 ngày — không tự đoán bị ảnh hưởng, chạy lại ingest khi có dữ liệu: npm run slo:ingest / npm run slo:timeline

---
