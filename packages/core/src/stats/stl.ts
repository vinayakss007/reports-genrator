/**
 * Lightweight STL-style additive decomposition.
 *
 * This is not a full STL with LOESS smoothers; it's a deterministic,
 * dependency-free additive decomposer suitable for visualization
 * overlays:
 *
 *   1. Trend: centered moving average of width = period.
 *   2. De-trended series: x_t - trend_t.
 *   3. Seasonal: per-phase mean of the de-trended series, repeated.
 *   4. Residual: x_t - trend_t - seasonal_t.
 *
 * For non-seasonal data (period <= 1) we treat the moving average as
 * the trend and seasonal as zero.
 *
 * No AI, no randomness, deterministic.
 */

export interface DecomposeOptions {
  /** Seasonality period. <=1 means non-seasonal. */
  period?: number;
}

export interface Decomposition {
  trend: number[];
  seasonal: number[];
  residual: number[];
}

export function decompose(values: readonly number[], opts: DecomposeOptions = {}): Decomposition {
  const period = Math.max(0, Math.floor(opts.period ?? 0));
  const n = values.length;
  const trend = movingAverage(values, period >= 2 ? period : 7);
  const seasonal: number[] = new Array(n).fill(0);
  if (period >= 2) {
    const phaseSums: number[] = new Array(period).fill(0);
    const phaseCounts: number[] = new Array(period).fill(0);
    for (let t = 0; t < n; t++) {
      if (Number.isFinite(trend[t]!)) {
        const d = values[t]! - trend[t]!;
        phaseSums[t % period]! += d;
        phaseCounts[t % period]! += 1;
      }
    }
    const phaseMeans: number[] = phaseSums.map((s, i) => (phaseCounts[i]! > 0 ? s / phaseCounts[i]! : 0));
    // Center seasonals so they sum to zero across one period.
    const meanOfPhases = phaseMeans.reduce((a, b) => a + b, 0) / period;
    for (let i = 0; i < period; i++) phaseMeans[i]! -= meanOfPhases;
    for (let t = 0; t < n; t++) seasonal[t] = phaseMeans[t % period]!;
  }
  const residual: number[] = new Array(n);
  for (let t = 0; t < n; t++) residual[t] = values[t]! - trend[t]! - seasonal[t]!;
  return { trend, seasonal, residual };
}

/**
 * Centered moving average of given window. Edges fall back to a
 * one-sided average so the output is the same length as the input.
 */
export function movingAverage(values: readonly number[], window: number): number[] {
  const n = values.length;
  const w = Math.max(1, Math.floor(window));
  const out: number[] = new Array(n);
  const half = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    let lo = i - half;
    let hi = i + half;
    if (lo < 0) lo = 0;
    if (hi >= n) hi = n - 1;
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j++) {
      sum += values[j]!;
      count += 1;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}
