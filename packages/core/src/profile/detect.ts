import type { DataType, SemanticType } from "@reports/shared";

/**
 * Pure, deterministic value classification used by the schema profiler.
 *
 * Every function in this file is a pure function of its inputs. No I/O,
 * no randomness, no AI. Same input → same output, every time.
 */

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_LIKE = /^-?\d+$/;
const NUMBER_LIKE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const CURRENCY_LIKE = /^[\s]*[$€£¥₹]\s?-?\d{1,3}(,\d{3})*(\.\d+)?\s*$/;
const PERCENT_LIKE = /^-?\d+(\.\d+)?\s*%$/;

export function isNullish(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "" || t === "null" || t === "NULL" || t === "NA" || t === "N/A") {
      return true;
    }
  }
  return false;
}

/**
 * Classify a single value into one of the primitive data types.
 * Returns "unknown" only when nothing else fits (rare for non-null inputs).
 */
export function detectValueType(v: unknown): DataType {
  if (isNullish(v)) return "unknown";

  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "unknown";
    return Number.isInteger(v) ? "integer" : "number";
  }
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? "datetime" : "unknown";
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length === 0) return "unknown";
    if (t === "true" || t === "false" || t === "TRUE" || t === "FALSE") {
      return "boolean";
    }
    if (INTEGER_LIKE.test(t)) return "integer";
    if (NUMBER_LIKE.test(t)) return "number";
    if (ISO_DATE.test(t)) return "date";
    if (ISO_DATETIME.test(t)) return "datetime";
    return "string";
  }
  return "unknown";
}

/**
 * Reduce two data-type observations to the most permissive type that
 * can hold both. Used to fold a column down to a single column type.
 *
 * Lattice (low → high):
 *   integer < number < string
 *   date    < datetime < string
 *   boolean < string
 *   unknown is identity (loses to anything concrete)
 */
export function widenType(a: DataType, b: DataType): DataType {
  if (a === b) return a;
  if (a === "unknown") return b;
  if (b === "unknown") return a;

  const numericPair = new Set(["integer", "number"]);
  if (numericPair.has(a) && numericPair.has(b)) return "number";

  const datePair = new Set(["date", "datetime"]);
  if (datePair.has(a) && datePair.has(b)) return "datetime";

  return "string";
}

/**
 * Heuristic semantic-type classifier. This is the deterministic fallback
 * used when the AI gateway's `classifySchema` is unavailable or disabled.
 *
 * Inputs are the column name and a sample of its non-null values.
 */
export function detectSemantic(
  name: string,
  values: readonly unknown[],
  type: DataType,
): SemanticType {
  const lower = name.toLowerCase();
  const sample = values.slice(0, 200);

  // Geo points: lat/long names with numeric values in valid ranges.
  if (
    (lower === "lat" || lower === "latitude" || lower.endsWith("_lat")) &&
    (type === "number" || type === "integer")
  ) {
    return "geo_point";
  }
  if (
    (lower === "lng" ||
      lower === "lon" ||
      lower === "long" ||
      lower === "longitude" ||
      lower.endsWith("_lng") ||
      lower.endsWith("_lon")) &&
    (type === "number" || type === "integer")
  ) {
    return "geo_point";
  }

  // Geo regions: country / state / region / city as strings.
  if (type === "string") {
    if (
      lower === "country" ||
      lower === "country_code" ||
      lower === "iso_country" ||
      lower === "state" ||
      lower === "province" ||
      lower === "region" ||
      lower === "city"
    ) {
      return "geo_region";
    }
  }

  // Currency: prefix or column name hints.
  if (
    lower.includes("price") ||
    lower.includes("revenue") ||
    lower.includes("cost") ||
    lower.includes("amount") ||
    lower.includes("usd") ||
    lower.includes("eur") ||
    lower.includes("salary")
  ) {
    if (type === "number" || type === "integer") return "currency";
  }
  if (
    type === "string" &&
    sample.length > 0 &&
    sample.every((v) => typeof v === "string" && CURRENCY_LIKE.test(v))
  ) {
    return "currency";
  }

  // Percent: `%` suffix or [0,1] range with name hints.
  if (
    type === "string" &&
    sample.length > 0 &&
    sample.every((v) => typeof v === "string" && PERCENT_LIKE.test(v))
  ) {
    return "percent";
  }
  if (
    (type === "number" || type === "integer") &&
    (lower.endsWith("_rate") ||
      lower.endsWith("_pct") ||
      lower.endsWith("_percent") ||
      lower === "rate" ||
      lower === "pct")
  ) {
    return "percent";
  }

  // ID: name hints + high cardinality (the cardinality check happens
  // upstream; here we use just the name pattern as a hint).
  if (
    lower === "id" ||
    lower.endsWith("_id") ||
    lower.endsWith("id") && lower.length <= 6 ||
    lower === "uuid"
  ) {
    return "id";
  }

  // Datetime: when type is already a date/datetime, mark accordingly.
  if (type === "datetime" || type === "date") return "datetime";

  // Numeric → measure; string → category.
  if (type === "number" || type === "integer") return "measure";
  if (type === "string") return "category";

  return "unknown";
}
