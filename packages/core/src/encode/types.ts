import type { ChartType, Field } from "@reports/shared";
import type { AggFn, Filter } from "../aggregate/index.js";

/**
 * A complete, deterministic chart specification. Same spec + same data
 * always produces the same render. Generated either by the auto-encoder
 * (deterministic from a Profile) or hand-edited in the chart editor.
 */
export interface ChartSpec {
  chart: ChartType;
  /** Encoding slots; not every chart uses every slot. */
  encoding: ChartEncoding;
  /** Pre-aggregation row filters. AND-combined. */
  filters?: readonly Filter[];
  /** Optional sort. Defaults are chart-type specific. */
  sort?: ReadonlyArray<{ field: string; dir: "asc" | "desc" }>;
  /** Top-N cap applied after aggregation. */
  limit?: number;
}

export interface ChartEncoding {
  /** X axis (or angle for radar / theta for pie). */
  x?: SlotField;
  /** Y axis (or radius for radar). Multiple measures can be passed for multi-series. */
  y?: SlotField | readonly SlotField[];
  /** Categorical color split. */
  color?: SlotField;
  /** Bubble size for scatter/bubble/bubble_map. */
  size?: SlotField;
  /** Faceting field for small multiples. */
  facet?: SlotField;
  /** Source for hierarchy charts (treemap, sunburst). */
  parent?: SlotField;
  /** Sankey/chord source. */
  source?: SlotField;
  /** Sankey/chord target. */
  target?: SlotField;
}

export interface SlotField {
  field: string;
  /**
   * Aggregation function for measure slots. Required for y/size when the
   * field is numeric and the chart aggregates (most do). Use `count` with
   * field `*` for raw row counts.
   */
  agg?: AggFn;
  /**
   * Display label override. Defaults to `field`.
   */
  label?: string;
}

/** A Profile-aware view of a field for encoder use. */
export type EncodableField = Pick<
  Field,
  "name" | "type" | "semantic" | "role" | "cardinality" | "isTemporal" | "isGeo"
>;
