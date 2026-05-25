/**
 * Holt-Winters triple exponential smoothing.
 *
 * Implements additive seasonality with smoothing parameters alpha
 * (level), beta (trend), gamma (seasonality), and integer period.
 * Returns fitted values for the historical range plus a forecast of
 * `horizon` steps.
 *
 * If `period` is 0 or 1, falls back to Holt's linear method (no
 * seasonality). When the input is shorter than 2 * period, we also
 * fall back to the linear method to avoid degenerate seasonal init.
 *
 * Pure deterministic. No AI.
 */

export interface ForecastOptions {
  alpha?: number;
  beta?: number;
  gamma?: number;
  /** Seasonality period; e.g. 7 for weekly daily data. */
  period?: number;
  /** Forecast horizon. Default 12. */
  horizon?: number;
}

export interface ForecastResult {
  /** Fitted values for each historical timestep. */
  fitted: number[];
  /** Forecasted values, length === horizon. */
  forecast: number[];
}

export function holtWinters(
  values: readonly number[],
  opts: ForecastOptions = {},
): ForecastResult {
  const alpha = clamp(opts.alpha ?? 0.5, 0, 1);
  const beta = clamp(opts.beta ?? 0.3, 0, 1);
  const gamma = clamp(opts.gamma ?? 0.3, 0, 1);
  const period = Math.max(0, Math.floor(opts.period ?? 0));
  const horizon = Math.max(0, Math.floor(opts.horizon ?? 12));

  const n = values.length;
  if (n === 0) return { fitted: [], forecast: [] };
  if (n === 1 || period === 1) {
    // No useful trend; flat forecast.
    return {
      fitted: [values[0]!],
      forecast: Array(horizon).fill(values[0]!),
    };
  }

  if (period < 2 || n < 2 * period) {
    return holt(values, alpha, beta, horizon);
  }

  // Initial level: mean of first season.
  let level = mean(values.slice(0, period));
  // Initial trend: average per-step change between first two seasons.
  let trend = 0;
  for (let i = 0; i < period; i++) {
    trend += (values[period + i]! - values[i]!) / period;
  }
  trend /= period;
  // Initial seasonal indices: deviations from level over first period.
  const seasonal: number[] = new Array(period);
  for (let i = 0; i < period; i++) seasonal[i] = values[i]! - level;

  const fitted: number[] = new Array(n);
  for (let t = 0; t < n; t++) {
    const s = seasonal[t % period]!;
    const x = values[t]!;
    fitted[t] = level + trend + s;
    const newLevel = alpha * (x - s) + (1 - alpha) * (level + trend);
    const newTrend = beta * (newLevel - level) + (1 - beta) * trend;
    seasonal[t % period] = gamma * (x - newLevel) + (1 - gamma) * s;
    level = newLevel;
    trend = newTrend;
  }

  const forecast: number[] = new Array(horizon);
  for (let h = 1; h <= horizon; h++) {
    forecast[h - 1] = level + h * trend + seasonal[(n + h - 1) % period]!;
  }
  return { fitted, forecast };
}

function holt(
  values: readonly number[],
  alpha: number,
  beta: number,
  horizon: number,
): ForecastResult {
  let level = values[0]!;
  let trend = values.length > 1 ? values[1]! - values[0]! : 0;
  const fitted: number[] = [level];
  for (let t = 1; t < values.length; t++) {
    const x = values[t]!;
    const prev = fitted[t - 1]!;
    fitted[t] = level + trend;
    const newLevel = alpha * x + (1 - alpha) * (level + trend);
    trend = beta * (newLevel - level) + (1 - beta) * trend;
    level = newLevel;
    void prev;
  }
  const forecast: number[] = new Array(horizon);
  for (let h = 1; h <= horizon; h++) forecast[h - 1] = level + h * trend;
  return { fitted, forecast };
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
