import { isNullish } from "./detect.js";

/**
 * Check whether a column behaves like an ordered timeline: when read in
 * row order, parseable date values are non-decreasing on a sample.
 *
 * Pure function. No I/O.
 *
 *  - Ignores nulls in the sample.
 *  - Returns false if fewer than 4 valid timestamps are present.
 *  - Returns false on the first decreasing pair.
 *  - Same input → same output (deterministic).
 */
export function isMonotonicTime(values: readonly unknown[]): boolean {
  let prev = -Infinity;
  let seen = 0;

  for (const v of values) {
    if (isNullish(v)) continue;
    const t = parseDate(v);
    if (t === null) return false; // not a time series
    if (t < prev) return false;
    prev = t;
    seen += 1;
  }

  return seen >= 4;
}

function parseDate(v: unknown): number | null {
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
