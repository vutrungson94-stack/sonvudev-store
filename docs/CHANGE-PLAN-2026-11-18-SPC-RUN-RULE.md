# Gate correction — 2026-11-18 — SPC "run on one side" rule

## Symptom

`metrics-trends` failed on 2026-11-18 with:

```
[spc] OUT OF CONTROL: 6 metric(s) ... escCopies, moneyCopies, initialsCopies,
sizeCopies, productPageLocales, productPageRenderers
```

All six are constant series (`2,2,2,...` or `1,1,1,...`) — no value changed.

## Root cause (gate is provably wrong)

`hasRunSameSide` in `scripts/spc-control-chart.mjs` used `>=` / `<=`. For a flat
series every value equals the mean, so `v >= mean` is always true; with the 8th
daily snapshot the run length reached 8 and the gate reported
"eight-points-one-side-of-mean" with no special cause. Western Electric rule 2
requires points STRICTLY on one side; a point exactly on the centre line is on
neither side and resets the run. This is a gate defect, not a process signal.

## Correction (per AGENTS.md §5: prove wrong first, then adjust)

- Reproduced locally: `npm run metrics:trends && npm run spc:check` exited 1
  with the same six metrics (evidence captured before any edit).
- Changed `>=`/`<=` to `>`/`<`; extracted the four pure rules into
  `scripts/lib/spc.mjs` so the gate and its tests share one implementation.
- Added `test/spc-control-chart.test.js`: flat series NOT out of control
  (negative control), eight strictly-above / strictly-below points ARE, real
  steady trend still fires.
- After the fix the same chain exits 0 ("all 17 metrics in statistical control").

## Not weakened

The control limits (3-sigma), MIN_SAMPLE=25, and the seven-point trend rule are
unchanged. Only the strictness of the "one side" comparison was corrected to
match the standard the gate claims to implement.
