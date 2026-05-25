import { z } from "zod";
import { ChartTypeSchema, ProfileSchema } from "./schemas.js";

export const AggFnSchema = z.enum([
  "sum",
  "avg",
  "count",
  "count_distinct",
  "min",
  "max",
  "median",
]);

export const SlotFieldSchema = z.object({
  field: z.string().min(1),
  agg: AggFnSchema.optional(),
  label: z.string().optional(),
});

export const FilterOpSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "nin",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
  "between",
]);

export const FilterSchema = z.object({
  field: z.string().min(1),
  op: FilterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  range: z
    .union([
      z.tuple([z.number(), z.number()]),
      z.tuple([z.string(), z.string()]),
    ])
    .optional(),
});

export const ChartEncodingSchema = z.object({
  x: SlotFieldSchema.optional(),
  y: z.union([SlotFieldSchema, z.array(SlotFieldSchema)]).optional(),
  color: SlotFieldSchema.optional(),
  size: SlotFieldSchema.optional(),
  facet: SlotFieldSchema.optional(),
  parent: SlotFieldSchema.optional(),
  source: SlotFieldSchema.optional(),
  target: SlotFieldSchema.optional(),
});

export const ChartSpecSchema = z.object({
  chart: ChartTypeSchema,
  encoding: ChartEncodingSchema,
  filters: z.array(FilterSchema).optional(),
  sort: z
    .array(
      z.object({
        field: z.string().min(1),
        dir: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
  limit: z.number().int().min(1).max(100_000).optional(),
});

export const ChartComputeRequestSchema = z.object({
  /** The dataset that produced the rows (for the profiler/preview link). Optional. */
  datasetId: z.string().uuid().optional(),
  spec: ChartSpecSchema,
  /**
   * The deterministic schema profile of the rows. Used for chart-type
   * compatibility checks; omit to skip checks.
   */
  profile: ProfileSchema.optional(),
  /**
   * Inline rows. The API can also resolve rows from a datasetId, but
   * accepting them inline keeps the endpoint usable for ad-hoc queries.
   */
  rows: z.array(z.record(z.string(), z.unknown())),
});

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type ChartComputeRequest = z.infer<typeof ChartComputeRequestSchema>;
