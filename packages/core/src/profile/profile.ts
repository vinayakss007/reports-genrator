import type { DataType, Field, Profile, SemanticType } from "@reports/shared";
import { detectSemantic, detectValueType, isNullish, widenType } from "./detect.js";
import { isMonotonicTime } from "./monotonic.js";

/**
 * Options for `profileRows`. All values default to deterministic and
 * conservative choices.
 */
export interface ProfileOptions {
  /**
   * Maximum number of rows used for inference. Larger samples are
   * truncated. Default 10000, which keeps the profiler bounded for
   * very large files.
   */
  sampleLimit?: number;
}

/**
 * Compute a deterministic schema Profile for a tabular sample.
 *
 * Pure function: same `(columnNames, rows)` → same `Profile`. No I/O,
 * no randomness, no AI. Used as the system-of-record schema profile by
 * the chart recommender.
 *
 *  - `columnNames` defines column order and identity.
 *  - `rows` may be longer than `sampleLimit`; we read a deterministic
 *    prefix.
 */
export function profileRows(
  columnNames: readonly string[],
  rows: readonly Record<string, unknown>[],
  opts: ProfileOptions = {},
): Profile {
  const limit = Math.max(1, opts.sampleLimit ?? 10_000);
  const sample = rows.length > limit ? rows.slice(0, limit) : rows;

  const fields: Field[] = columnNames.map((name) =>
    profileColumn(name, sample),
  );

  return { fields, rowCount: rows.length };
}

/**
 * Compute Field metadata for a single column from a row sample.
 * Exposed for callers that want column-level profiling without
 * allocating a full Profile.
 */
export function profileColumn(
  name: string,
  rows: readonly Record<string, unknown>[],
): Field {
  const values: unknown[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) values[i] = rows[i]?.[name];

  // Type fold.
  let type: DataType = "unknown";
  let nulls = 0;
  for (const v of values) {
    if (isNullish(v)) {
      nulls += 1;
      continue;
    }
    type = widenType(type, detectValueType(v));
  }

  const total = values.length;
  const nullRate = total === 0 ? 0 : nulls / total;

  // Cardinality on the sample. We use a deterministic canonicalization
  // for object/Date values via JSON-safe coercion.
  const distinct = new Set<string>();
  for (const v of values) {
    if (isNullish(v)) continue;
    distinct.add(canon(v));
  }
  const cardinality = distinct.size;

  // Non-null sample for downstream classifiers.
  const nonNull = values.filter((v) => !isNullish(v));

  const semantic: SemanticType = detectSemantic(name, nonNull, type);

  const isTemporal =
    type === "datetime" ||
    type === "date" ||
    // Only sniff string columns for monotonic time; sequential integers
    // (e.g. ids) must not be reclassified as timestamps.
    (type === "string" && isMonotonicTime(values));

  const isGeo = semantic === "geo_point" || semantic === "geo_region";

  return {
    name,
    type,
    semantic,
    cardinality,
    nullRate,
    isTemporal,
    isGeo,
  };
}

/**
 * Stable canonical string for set-membership. Numbers and booleans use
 * their literal form; Dates use ISO; strings are kept verbatim. This
 * guarantees deterministic distinct counts.
 */
function canon(v: unknown): string {
  if (v instanceof Date) return `D:${v.getTime()}`;
  if (typeof v === "number") return `N:${v}`;
  if (typeof v === "boolean") return `B:${v}`;
  if (typeof v === "string") return `S:${v}`;
  if (typeof v === "bigint") return `I:${v.toString()}`;
  // Objects/arrays: stringify with sorted keys for determinism.
  try {
    return `O:${JSON.stringify(v, sortedKeys)}`;
  } catch {
    return `X:${String(v)}`;
  }
}

function sortedKeys(_k: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  }
  return value;
}

/**
 * Identify primary-key candidate columns: distinct count equals row
 * count and null rate is zero. Returned in input column order.
 */
export function primaryKeyCandidates(profile: Profile): string[] {
  const total = profile.rowCount ?? 0;
  if (total === 0) return [];
  return profile.fields
    .filter((f) => (f.cardinality ?? 0) === total && (f.nullRate ?? 0) === 0)
    .map((f) => f.name);
}
