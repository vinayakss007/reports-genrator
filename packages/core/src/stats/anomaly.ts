/**
 * Rolling MAD-based anomaly detection.
 *
 * For each point i, compute the median and MAD (median absolute
 * deviation) over a window of the previous `window` points. A point
 * is flagged as anomalous when `|x_i - median| > k * MAD * 1.4826`,
 * where 1.4826 is the standard MAD-to-sigma constant for a normal
 * distribution.
 *
 * Pure deterministic. No AI.
 */

export interface AnomalyOptions {
  /** Rolling window length. Must be >= 3. Default 24. */
  window?: number;
  /** Threshold in robust standard deviations. Default 3.5. */
  k?: number;
}

export interface AnomalyPoint {
  index: number;
  value: number;
  expected: number;
  /** Robust z-score. */
  z: number;
  isAnomaly: boolean;
}

export function detectAnomalies(
  values: readonly number[],
  opts: AnomalyOptions = {},
): AnomalyPoint[] {
  const window = Math.max(3, opts.window ?? 24);
  const k = opts.k ?? 3.5;
  const out: AnomalyPoint[] = [];

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window);
    const slice = values.slice(start, i);
    if (slice.length < 3) {
      out.push({ index: i, value: values[i]!, expected: values[i]!, z: 0, isAnomaly: false });
      continue;
    }
    const med = median(slice);
    const mad = median(slice.map((v) => Math.abs(v - med)));
    const sigma = mad * 1.4826;
    const x = values[i]!;
    const z = sigma === 0 ? 0 : (x - med) / sigma;
    out.push({
      index: i,
      value: x,
      expected: med,
      z,
      isAnomaly: Math.abs(z) > k,
    });
  }

  return out;
}

function median(xs: readonly number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
