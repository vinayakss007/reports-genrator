/**
 * Pure, deterministic filter predicate engine.
 *
 * A `Filter` describes a row predicate over a single field. `applyFilters`
 * returns a new array containing rows that satisfy ALL filters (AND).
 * Empty filter list returns the input unchanged.
 *
 * No I/O. No randomness. No AI. Same input -> same output.
 */

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "nin"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null"
  | "between";

export interface Filter {
  field: string;
  op: FilterOp;
  /** Single value for eq/neq/gt/gte/lt/lte/contains/starts_with/ends_with. */
  value?: string | number | boolean | null;
  /** Array value for in/nin. */
  values?: ReadonlyArray<string | number | boolean | null>;
  /** [low, high] inclusive for `between`. */
  range?: readonly [number, number] | readonly [string, string];
}

export function applyFilters<R extends Record<string, unknown>>(
  rows: readonly R[],
  filters: readonly Filter[],
): R[] {
  if (filters.length === 0) return rows.slice();
  const out: R[] = [];
  outer: for (const row of rows) {
    for (const f of filters) {
      if (!matches(row, f)) continue outer;
    }
    out.push(row);
  }
  return out;
}

function matches(row: Record<string, unknown>, f: Filter): boolean {
  const v = row[f.field];
  switch (f.op) {
    case "is_null":
      return v == null || v === "";
    case "is_not_null":
      return v != null && v !== "";
    case "eq":
      return looseEq(v, f.value);
    case "neq":
      return !looseEq(v, f.value);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = numeric(v);
      const b = numeric(f.value);
      if (a === null || b === null) return false;
      if (f.op === "gt") return a > b;
      if (f.op === "gte") return a >= b;
      if (f.op === "lt") return a < b;
      return a <= b;
    }
    case "in":
      if (!f.values) return false;
      return f.values.some((x) => looseEq(v, x));
    case "nin":
      if (!f.values) return true;
      return !f.values.some((x) => looseEq(v, x));
    case "contains":
      return typeof v === "string" && typeof f.value === "string" && v.includes(f.value);
    case "starts_with":
      return typeof v === "string" && typeof f.value === "string" && v.startsWith(f.value);
    case "ends_with":
      return typeof v === "string" && typeof f.value === "string" && v.endsWith(f.value);
    case "between": {
      if (!f.range) return false;
      const a = numeric(v);
      const lo = numeric(f.range[0]);
      const hi = numeric(f.range[1]);
      if (a === null || lo === null || hi === null) return false;
      return a >= lo && a <= hi;
    }
    default:
      return false;
  }
}

/** Loose equality that treats numeric strings and numbers as equal. */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const an = numeric(a);
  const bn = numeric(b);
  if (an !== null && bn !== null) return an === bn;
  return String(a) === String(b);
}

function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(t);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}
