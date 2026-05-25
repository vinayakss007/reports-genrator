import type { Field } from "@reports/shared";

/**
 * Pure deterministic group-by + aggregation engine.
 *
 * Inputs: rows (plain objects), a list of dimension column names to
 * group on, and a list of measure aggregations. Output: aggregated
 * rows with one entry per distinct dimension combination, in stable
 * sorted order so the same input always produces the same output.
 *
 * No I/O. No randomness. No AI.
 */

export type AggFn = "sum" | "avg" | "count" | "count_distinct" | "min" | "max" | "median";

export interface MeasureAgg {
  /** The source measure column. Use `"*"` with `count` for row count. */
  field: string;
  fn: AggFn;
  /** Output column name. Defaults to `${fn}_${field}`. */
  as?: string;
}

export interface AggregateSpec {
  /** Dimension columns to group on. Empty = single-row aggregate. */
  groupBy: readonly string[];
  /** Aggregations to compute. */
  measures: readonly MeasureAgg[];
  /**
   * Optional limit on output rows after sorting. Useful for top-N.
   */
  limit?: number;
  /**
   * Sort spec. If omitted, output is sorted by groupBy columns ascending
   * for determinism. To get top-N by a measure, sort by the measure desc.
   */
  sort?: ReadonlyArray<{ field: string; dir: "asc" | "desc" }>;
}

export interface AggregateResult {
  rows: Record<string, unknown>[];
  /** Names of all output columns in stable order: dims first, then measures. */
  columns: string[];
}

export function aggregate(
  rows: readonly Record<string, unknown>[],
  spec: AggregateSpec,
): AggregateResult {
  const measureNames = spec.measures.map((m) => m.as ?? defaultName(m));
  const columns = [...spec.groupBy, ...measureNames];

  if (spec.groupBy.length === 0) {
    const single = computeMeasures(rows, spec.measures);
    return { rows: [single], columns };
  }

  // Stable group key encoding so the same dimension values always
  // collide deterministically.
  const groups = new Map<string, Record<string, unknown>[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = groupKey(row, spec.groupBy);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const key of order) {
    const bucket = groups.get(key)!;
    const dimRow: Record<string, unknown> = {};
    for (const dim of spec.groupBy) dimRow[dim] = bucket[0]![dim] ?? null;
    const measureRow = computeMeasures(bucket, spec.measures);
    out.push({ ...dimRow, ...measureRow });
  }

  // Sorting. Default: groupBy asc, then measures asc, all stable.
  const sortSpec =
    spec.sort && spec.sort.length > 0
      ? spec.sort
      : spec.groupBy.map((f) => ({ field: f, dir: "asc" as const }));

  out.sort((a, b) => {
    for (const s of sortSpec) {
      const cmp = compareValues(a[s.field], b[s.field]);
      if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
    }
    // Final tiebreak on canonical key for absolute determinism.
    return groupKey(a, spec.groupBy) < groupKey(b, spec.groupBy) ? -1 : 1;
  });

  if (spec.limit && out.length > spec.limit) out.length = spec.limit;
  return { rows: out, columns };
}

function defaultName(m: MeasureAgg): string {
  if (m.fn === "count" && m.field === "*") return "count";
  return `${m.fn}_${m.field}`;
}

function groupKey(row: Record<string, unknown>, dims: readonly string[]): string {
  let s = "";
  for (const d of dims) s += "\x1f" + canon(row[d]);
  return s;
}

function canon(v: unknown): string {
  if (v == null) return "\x00";
  if (v instanceof Date) return "D" + v.getTime();
  if (typeof v === "number") return "N" + v;
  if (typeof v === "boolean") return "B" + v;
  return "S" + String(v);
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) {
    if (na === nb) return 0;
    return na < nb ? -1 : 1;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}

function computeMeasures(
  rows: readonly Record<string, unknown>[],
  measures: readonly MeasureAgg[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of measures) {
    const name = m.as ?? defaultName(m);
    out[name] = applyAgg(rows, m);
  }
  return out;
}

function applyAgg(rows: readonly Record<string, unknown>[], m: MeasureAgg): unknown {
  if (m.fn === "count" && m.field === "*") return rows.length;
  if (m.fn === "count") {
    let n = 0;
    for (const r of rows) if (r[m.field] != null && r[m.field] !== "") n += 1;
    return n;
  }
  if (m.fn === "count_distinct") {
    const set = new Set<string>();
    for (const r of rows) {
      const v = r[m.field];
      if (v == null || v === "") continue;
      set.add(canon(v));
    }
    return set.size;
  }
  const values: number[] = [];
  for (const r of rows) {
    const n = toNumber(r[m.field]);
    if (n !== null) values.push(n);
  }
  if (values.length === 0) return null;
  switch (m.fn) {
    case "sum":
      return kahanSum(values);
    case "avg":
      return kahanSum(values) / values.length;
    case "min":
      return values.reduce((a, b) => (a < b ? a : b));
    case "max":
      return values.reduce((a, b) => (a > b ? a : b));
    case "median":
      return median(values);
  }
  return null;
}

/**
 * Kahan compensated summation for numerical stability over long
 * floating-point sums.
 */
function kahanSum(values: readonly number[]): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const y = v - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Deterministic aggregation chooser. Given a measure field profile,
 * return the default aggregation function.
 *
 * Rules:
 *   - integer/number with semantic 'currency' or 'measure'  -> sum
 *   - integer/number with semantic 'percent'                 -> avg
 *   - integer/number identified as id                        -> count_distinct
 *   - boolean                                                 -> count
 *   - string/category                                         -> count
 *   - datetime/date                                           -> count
 */
export function chooseAgg(field: Field): AggFn {
  if (field.role === "id" || field.semantic === "id") return "count_distinct";
  if (field.semantic === "percent") return "avg";
  if (field.type === "number" || field.type === "integer") return "sum";
  return "count";
}
