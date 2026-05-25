/**
 * Deterministic narrative-bullet generator. This is the system-of-
 * record fallback used when the AI gateway's `narrativeInsights` call
 * is disabled or fails. Emits up to 3 short bullets that summarize a
 * measure series.
 *
 * No AI, no randomness, no I/O. Pure function of the input stats.
 */

export interface SeriesStats {
  /** Field display name. */
  field: string;
  /** Aggregation applied (sum, avg, ...). */
  agg?: string;
  /** Numeric values in display order (typically time-ordered). */
  values: readonly number[];
  /** Optional labels for the values, used in 'highest/lowest' bullets. */
  labels?: readonly string[];
}

export function narrativeInsights(stats: SeriesStats): string[] {
  const v = stats.values;
  if (v.length === 0) return [`No data for ${stats.field}.`];

  const labels = stats.labels ?? [];
  const out: string[] = [];

  // 1) total / average
  const sum = v.reduce((a, b) => a + b, 0);
  const avg = sum / v.length;
  if (stats.agg === "sum" || stats.agg == null) {
    out.push(
      `Total ${stats.field}: ${fmt(sum)} across ${v.length} ${pluralize("point", v.length)}.`,
    );
  } else {
    out.push(`Average ${stats.field}: ${fmt(avg)}.`);
  }

  // 2) extremes
  let maxIdx = 0;
  let minIdx = 0;
  for (let i = 1; i < v.length; i++) {
    if (v[i]! > v[maxIdx]!) maxIdx = i;
    if (v[i]! < v[minIdx]!) minIdx = i;
  }
  const maxLabel = labels[maxIdx] ?? `point ${maxIdx + 1}`;
  const minLabel = labels[minIdx] ?? `point ${minIdx + 1}`;
  if (v.length >= 2) {
    out.push(
      `Highest at ${maxLabel} (${fmt(v[maxIdx]!)}); lowest at ${minLabel} (${fmt(v[minIdx]!)}).`,
    );
  }

  // 3) trend (first vs last)
  if (v.length >= 4) {
    const first = v[0]!;
    const last = v[v.length - 1]!;
    if (first === 0 && last === 0) {
      out.push(`${stats.field} is flat at zero across the range.`);
    } else if (first === 0) {
      out.push(`${stats.field} grew from 0 to ${fmt(last)}.`);
    } else {
      const pct = ((last - first) / Math.abs(first)) * 100;
      const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
      out.push(
        `Overall trend: ${dir} ${Math.abs(pct).toFixed(1)}% (${fmt(first)} -> ${fmt(last)}).`,
      );
    }
  }

  return out.slice(0, 3);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(2) + "K";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function pluralize(s: string, n: number): string {
  return n === 1 ? s : `${s}s`;
}
