/**
 * Local copies of the chart types used by the web renderer. These mirror
 * the shapes shipped from the API but are kept here so the web bundle
 * does not depend on the server packages.
 */

export type AggFn = "sum" | "avg" | "count" | "count_distinct" | "min" | "max" | "median";

export interface SlotField {
  field: string;
  agg?: AggFn;
  label?: string;
}

export interface ChartEncoding {
  x?: SlotField;
  y?: SlotField | SlotField[];
  color?: SlotField;
  size?: SlotField;
  facet?: SlotField;
  parent?: SlotField;
  source?: SlotField;
  target?: SlotField;
}

export interface FieldProfile {
  name: string;
  type: string;
  semantic?: string;
  cardinality?: number;
  nullRate?: number;
  isTemporal?: boolean;
  isGeo?: boolean;
  role?: string;
}

export interface Profile {
  fields: FieldProfile[];
  rowCount?: number;
}

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
  value?: string | number | boolean | null;
  values?: Array<string | number | boolean | null>;
  range?: [number, number] | [string, string];
}

export interface ChartSpec {
  chart: string;
  encoding: ChartEncoding;
  filters?: Filter[];
  sort?: Array<{ field: string; dir: "asc" | "desc" }>;
  limit?: number;
}

export interface ComputedChart {
  rows: Record<string, unknown>[];
  columns: string[];
  colors: string[];
  spec: ChartSpec;
}

export interface SeriesStats {
  values: number[];
  labels?: string[];
  decomposition: { trend: number[]; seasonal: number[]; residual: number[] };
  anomalies: Array<{ index: number; value: number; expected: number; z: number; isAnomaly: boolean }>;
  forecast: { fitted: number[]; forecast: number[] };
}
