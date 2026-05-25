import { z } from "zod";
import { ChartSpecSchema, FilterOpSchema } from "./charts.js";

/**
 * Dashboard model.
 *
 * A Dashboard is a layout of Tiles, each tile bound to a dataset and a
 * ChartSpec. Dashboard-level Parameters become filters that are AND-
 * combined into every tile's existing filter list at compute time.
 *
 * Layout is a 12-column grid. (x, y, w, h) are the grid coords in
 * cells. The renderer (`react-grid-layout`) consumes the same shape.
 */

export const TileLayoutSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(1000),
});

export const TileSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200).optional(),
  datasetId: z.string().uuid(),
  spec: ChartSpecSchema,
  layout: TileLayoutSchema,
});

export const ParameterSchema = z.object({
  /** Identifier for the param. UI uses this as the input label. */
  name: z.string().min(1).max(100),
  /** Field on each dataset the param filters. */
  field: z.string().min(1).max(200),
  /** Comparison operator. */
  op: FilterOpSchema,
  /**
   * Default value. Strings, numbers, booleans, and string arrays
   * (for `in`/`nin`). `null` clears the param.
   */
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
      z.null(),
    ])
    .optional(),
});

export const DashboardSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  parameters: z.array(ParameterSchema).max(20),
  tiles: z.array(TileSchema).max(50),
});

export const CreateDashboardRequestSchema = z.object({
  name: z.string().min(1).max(200),
  parameters: z.array(ParameterSchema).max(20).optional(),
  tiles: z.array(TileSchema.omit({ id: true })).max(50).optional(),
});

export const UpdateDashboardRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parameters: z.array(ParameterSchema).max(20).optional(),
  tiles: z.array(TileSchema).max(50).optional(),
});

export type TileLayout = z.infer<typeof TileLayoutSchema>;
export type Tile = z.infer<typeof TileSchema>;
export type Parameter = z.infer<typeof ParameterSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type CreateDashboardRequest = z.infer<typeof CreateDashboardRequestSchema>;
export type UpdateDashboardRequest = z.infer<typeof UpdateDashboardRequestSchema>;

// ---- exports ----

export const ExportFormatSchema = z.enum(["csv", "xlsx", "json"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportTargetSchema = z.union([
  z.object({
    kind: z.literal("dataset"),
    datasetId: z.string().uuid(),
    limit: z.number().int().min(1).max(1_000_000).optional(),
  }),
  z.object({
    kind: z.literal("dashboard"),
    dashboardId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("chart"),
    datasetId: z.string().uuid(),
    spec: ChartSpecSchema,
  }),
]);
export type ExportTarget = z.infer<typeof ExportTargetSchema>;

export const ExportRequestSchema = z.object({
  target: ExportTargetSchema,
  format: ExportFormatSchema,
});
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

// ---- schedules ----

export const ScheduleDeliverySchema = z.union([
  z.object({
    kind: z.literal("webhook"),
    /** HTTPS recommended; HTTP allowed for local development. */
    url: z.string().url(),
    /** Optional headers to include with the POST. Values are not encrypted. */
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    kind: z.literal("file"),
    /** Subdirectory under DATA_DIR/exports. Created if missing. */
    dir: z.string().min(1).max(200).default("scheduled"),
  }),
]);
export type ScheduleDelivery = z.infer<typeof ScheduleDeliverySchema>;

export const ScheduleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  /** Standard 5-field cron expression (m h dom mon dow). */
  cron: z.string().min(1).max(100),
  target: ExportTargetSchema,
  format: ExportFormatSchema,
  delivery: ScheduleDeliverySchema,
  enabled: z.boolean(),
  createdAt: z.string(),
  /** ISO timestamp of the most recent execution. */
  lastRunAt: z.string().optional(),
  /** Status of the most recent execution. */
  lastStatus: z.enum(["ok", "error"]).optional(),
  /** Short human-readable message from the most recent execution. */
  lastMessage: z.string().max(2000).optional(),
});

export const CreateScheduleRequestSchema = z.object({
  name: z.string().min(1).max(200),
  cron: z.string().min(1).max(100),
  target: ExportTargetSchema,
  format: ExportFormatSchema,
  delivery: ScheduleDeliverySchema,
  enabled: z.boolean().default(true),
});
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
