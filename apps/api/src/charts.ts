import {
  aggregate,
  applyFilters,
  type AggregateSpec,
  type ChartSpec,
  type Filter,
  type MeasureAgg,
  type SlotField,
} from "@reports/core";

/**
 * Apply a ChartSpec to a row sample: filter, aggregate, return rows
 * shaped for the renderer plus the column order.
 *
 * Pure deterministic. The same spec + same rows always produces the
 * same output. No AI involved.
 */
export interface ComputedChart {
  rows: Record<string, unknown>[];
  columns: string[];
}

export function computeChart(rows: readonly Record<string, unknown>[], spec: ChartSpec): ComputedChart {
  const filtered = applyFilters(rows, (spec.filters as readonly Filter[] | undefined) ?? []);
  const aggSpec = chartSpecToAggregateSpec(spec);
  if (aggSpec === null) {
    // No aggregation needed (e.g. scatter, table) — pass through with
    // only the projected columns in stable order.
    const cols = collectProjectedColumns(spec);
    const projected = filtered.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of cols) out[c] = r[c] ?? null;
      return out;
    });
    return { rows: projected.slice(0, spec.limit), columns: cols };
  }
  const result = aggregate(filtered, aggSpec);
  return { rows: result.rows, columns: result.columns };
}

/**
 * Build an AggregateSpec from a ChartSpec when the chart type is one
 * that aggregates. Returns null for chart types that consume raw rows
 * (scatter, table, candlestick).
 */
function chartSpecToAggregateSpec(spec: ChartSpec): AggregateSpec | null {
  const passthrough = new Set([
    "scatter",
    "bubble",
    "hexbin",
    "table",
    "parallel_coordinates",
    "candlestick",
  ]);
  if (passthrough.has(spec.chart)) return null;

  const groupBy: string[] = [];
  const measures: MeasureAgg[] = [];

  const enc = spec.encoding;

  // Dimensions: x (when not numeric), color, parent, source, target, facet.
  for (const slot of [enc.x, enc.color, enc.parent, enc.source, enc.target, enc.facet]) {
    if (slot && !slot.agg) {
      if (!groupBy.includes(slot.field)) groupBy.push(slot.field);
    }
  }

  // Measures: y (single or array), size when aggregated.
  const ySlots: SlotField[] = Array.isArray(enc.y)
    ? (enc.y as readonly SlotField[]).slice()
    : enc.y
      ? [enc.y as SlotField]
      : [];
  for (const m of ySlots) {
    measures.push(slotToMeasure(m));
  }
  if (enc.size && enc.size.agg) {
    measures.push(slotToMeasure(enc.size));
  }

  // x without agg AND with numeric type implies passthrough; we already returned above.
  if (measures.length === 0) {
    measures.push({ field: "*", fn: "count" });
  }

  return {
    groupBy,
    measures,
    sort: spec.sort,
    limit: spec.limit,
  };
}

function slotToMeasure(slot: SlotField): MeasureAgg {
  return {
    field: slot.field,
    fn: slot.agg ?? "sum",
    as: slot.label,
  };
}

function collectProjectedColumns(spec: ChartSpec): string[] {
  const cols: string[] = [];
  const push = (name?: string) => {
    if (!name) return;
    if (!cols.includes(name)) cols.push(name);
  };
  const enc = spec.encoding;
  push(enc.x?.field);
  if (Array.isArray(enc.y)) {
    for (const m of enc.y as readonly SlotField[]) push(m.field);
  } else if (enc.y) {
    push((enc.y as SlotField).field);
  }
  push(enc.color?.field);
  push(enc.size?.field);
  push(enc.facet?.field);
  push(enc.parent?.field);
  push(enc.source?.field);
  push(enc.target?.field);
  return cols;
}
