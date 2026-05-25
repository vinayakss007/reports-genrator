import { z } from "zod";

export const DataTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "datetime",
  "date",
  "geo",
  "unknown",
]);

export const SemanticTypeSchema = z.enum([
  "currency",
  "percent",
  "id",
  "geo_region",
  "geo_point",
  "datetime",
  "category",
  "measure",
  "unknown",
]);

export const FieldRoleSchema = z.enum(["dimension", "measure", "time", "geo", "id"]);

export const FieldSchema = z.object({
  name: z.string().min(1),
  type: DataTypeSchema,
  semantic: SemanticTypeSchema.optional(),
  role: FieldRoleSchema.optional(),
  cardinality: z.number().int().nonnegative().optional(),
  nullRate: z.number().min(0).max(1).optional(),
  isTemporal: z.boolean().optional(),
  isGeo: z.boolean().optional(),
});

export const ProfileSchema = z.object({
  fields: z.array(FieldSchema).min(1),
  rowCount: z.number().int().nonnegative().optional(),
  intent: z
    .enum([
      "auto",
      "compare",
      "trend",
      "part_to_whole",
      "distribution",
      "relationship",
      "hierarchy",
      "geo",
      "kpi",
      "table",
    ])
    .optional(),
});

export const ChartTypeSchema = z.enum([
  "bar",
  "column",
  "grouped_bar",
  "stacked_bar",
  "stacked_bar_100",
  "lollipop",
  "radar",
  "bullet",
  "line",
  "multi_line",
  "area",
  "stacked_area",
  "step_line",
  "candlestick",
  "sparkline",
  "pie",
  "donut",
  "treemap",
  "sunburst",
  "funnel",
  "waffle",
  "marimekko",
  "histogram",
  "density",
  "box",
  "violin",
  "ridgeline",
  "ecdf",
  "scatter",
  "bubble",
  "hexbin",
  "heatmap",
  "correlation_matrix",
  "parallel_coordinates",
  "tree",
  "dendrogram",
  "sankey",
  "chord",
  "network",
  "choropleth",
  "point_map",
  "bubble_map",
  "heat_map",
  "flow_map",
  "table",
  "pivot_table",
  "kpi",
  "gauge",
  "progress",
  "big_number",
]);

export const RecommendationSchema = z.object({
  chart: ChartTypeSchema,
  score: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
});

export const RecommendationResultSchema = z.object({
  recommendations: z.array(RecommendationSchema).min(1).max(20),
  source: z.enum(["core", "ai"]),
  fallbackReason: z
    .enum([
      "ai_disabled",
      "ai_timeout",
      "ai_invalid_response",
      "ai_provider_error",
      "feature_disabled",
    ])
    .optional(),
});

/**
 * Schema applied to AI provider responses inside the gateway.
 * Anything failing this schema is silently rejected and core fallback
 * is returned instead.
 */
export const AiRecommendResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema).min(1).max(20),
});
