// Pure statistical-process-control rules, shared by the gate and its tests.
// Keeping them free of file I/O / process.exit means a negative control can
// import and exercise the exact code the gate runs, not a copy of it.

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const stdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + Math.pow(b - m, 2), 0) / xs.length);
};

// Eight consecutive points STRICTLY on one side of the mean.
// A point exactly equal to the mean is on neither side and resets the run.
// Using >= / <= makes a perfectly flat series (every value == mean, e.g. a
// duplicated-literal counter that never changes) look like "8 above the mean"
// and trips the gate with no special cause — exactly what happened when the
// 8th daily snapshot turned six constant metrics red on 2026-11-18.
export const hasRunSameSide = (values, meanValue) => {
  let run = 0;
  for (const v of values) {
    if (v > meanValue) run++;
    else run = 0;
    if (run >= 8) return true;
  }
  run = 0;
  for (const v of values) {
    if (v < meanValue) run++;
    else run = 0;
    if (run >= 8) return true;
  }
  return false;
};

// Seven steadily increasing or decreasing points.
export const hasSteadyTrend = (values) => {
  if (values.length < 7) return false;
  let inc = 0, dec = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[i - 1]) { inc++; dec = 0; }
    else if (values[i] < values[i - 1]) { dec++; inc = 0; }
    else { inc = 0; dec = 0; }
    if (inc >= 7 || dec >= 7) return true;
  }
  return false;
};
