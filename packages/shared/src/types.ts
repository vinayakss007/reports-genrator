/**
 * Domain types shared across the monorepo.
 * Pure types only — no runtime logic, no I/O.
 */

export type DataType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "datetime"
  | "date"
  | "geo"
  | "unknown";

export type SemanticType =
  | "currency"
  | "percent"
  | "id"
  | "geo_region"
  | "geo_point"
  | "datetime"
  | "category"
  | "measure"
  | "unknown";

export type FieldRole = "dimension" | "measure" | "time" | "geo" | "id";

export interface Field {
  /** Stable column name. */
  name: string;
  /** Detected primitive data type. */
  type: DataType;
  /** Heuristic semantic type (regex/heuristic in core; AI may refine via gateway). */
  semantic?: SemanticType;
  /** Inferred role at modeling time. */
  role?: FieldRole;
  /** Distinct value count (sampled or exact). */
  cardinality?: number;
  /** Fraction of nulls in [0, 1]. */
  nullRate?: number;
  /** True when temporal values are strictly increasing on a sorted sample. */
  isTemporal?: boolean;
  /** True for lat/lng/geo region fields. */
  isGeo?: boolean;
}

/**
 * A schema profile passed to the recommender.
 * `rowCount` is the dataset row count after any pre-filter.
 */
export interface Profile {
  fields: Field[];
  rowCount?: number;
  /**
   * Optional user/system intent. When omitted, recommender infers from fields.
   */
  intent?:
    | "auto"
    | "compare"
    | "trend"
    | "part_to_whole"
    | "distribution"
    | "relationship"
    | "hierarchy"
    | "geo"
    | "kpi"
    | "table";
}

/** Canonical chart-type identifiers used across the system. */
export type ChartType =
  // comparison
  | "bar"
  | "column"
  | "grouped_bar"
  | "stacked_bar"
  | "stacked_bar_100"
  | "lollipop"
  | "radar"
  | "bullet"
  // trend
  | "line"
  | "multi_line"
  | "area"
  | "stacked_area"
  | "step_line"
  | "candlestick"
  | "sparkline"
  // part-to-whole
  | "pie"
  | "donut"
  | "treemap"
  | "sunburst"
  | "funnel"
  | "waffle"
  | "marimekko"
  // distribution
  | "histogram"
  | "density"
  | "box"
  | "violin"
  | "ridgeline"
  | "ecdf"
  // relationship
  | "scatter"
  | "bubble"
  | "hexbin"
  | "heatmap"
  | "correlation_matrix"
  | "parallel_coordinates"
  // hierarchy / flow
  | "tree"
  | "dendrogram"
  | "sankey"
  | "chord"
  | "network"
  // geo
  | "choropleth"
  | "point_map"
  | "bubble_map"
  | "heat_map"
  | "flow_map"
  // tabular / KPI
  | "table"
  | "pivot_table"
  | "kpi"
  | "gauge"
  | "progress"
  | "big_number";

export interface Recommendation {
  chart: ChartType;
  /** Score in [0, 1]. Higher is better. */
  score: number;
  /** Short, human-readable reason from the rule engine. */
  reason: string;
}

export interface RecommendationResult {
  /** Always populated by the deterministic core. */
  recommendations: Recommendation[];
  /** Indicates whether the AI sidecar contributed to this response. */
  source: "core" | "ai";
  /**
   * Reason for fallback when source === "core" but AI was attempted.
   * Omitted when AI is disabled by config.
   */
  fallbackReason?:
    | "ai_disabled"
    | "ai_timeout"
    | "ai_invalid_response"
    | "ai_provider_error"
    | "feature_disabled";
}
