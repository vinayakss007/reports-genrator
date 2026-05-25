/**
 * Deterministic chart encoder.
 *
 * Given a Profile and a chosen chart type, produce a ChartSpec by
 * filling encoding slots from the available fields. Same inputs ->
 * same spec.
 *
 * The encoder is intentionally simple: it picks the best-fit field
 * for each slot using role + cardinality + name heuristics. For any
 * chart that needs a measure, the aggregation comes from `chooseAgg`.
 *
 * No AI, no randomness.
 */

import type { ChartType, Profile } from "@reports/shared";
import { inferRoles } from "../recommend/roles.js";
import { chooseAgg } from "../aggregate/index.js";
import type { ChartEncoding, ChartSpec, EncodableField, SlotField } from "./types.js";

export interface AutoEncodeOptions {
  /** Optional cap on Y measures used (multi-line, grouped bar). */
  maxMeasures?: number;
}

export function autoEncode(
  profile: Profile,
  chart: ChartType,
  opts: AutoEncodeOptions = {},
): ChartSpec {
  const fields = inferRoles(profile.fields) as EncodableField[];
  const measures = fields.filter((f) => f.role === "measure");
  const dims = fields.filter((f) => f.role === "dimension");
  const times = fields.filter((f) => f.role === "time");
  const geos = fields.filter((f) => f.role === "geo");
  const ids = fields.filter((f) => f.role === "id");
  const maxM = Math.max(1, opts.maxMeasures ?? 4);

  const encoding: ChartEncoding = {};

  switch (chart) {
    case "line":
    case "multi_line":
    case "area":
    case "stacked_area":
    case "step_line":
    case "sparkline": {
      if (times[0]) encoding.x = { field: times[0].name };
      else if (dims[0]) encoding.x = { field: dims[0].name };
      const ms = measures.slice(0, chart === "multi_line" ? maxM : 1);
      encoding.y = ms.map((m) => measureSlot(m));
      if (chart === "multi_line" && dims[0] && measures.length === 1) {
        encoding.color = { field: dims[0].name };
      }
      break;
    }
    case "bar":
    case "column":
    case "lollipop": {
      if (dims[0]) encoding.x = { field: dims[0].name };
      else if (times[0]) encoding.x = { field: times[0].name };
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      break;
    }
    case "grouped_bar":
    case "stacked_bar":
    case "stacked_bar_100": {
      if (dims[0]) encoding.x = { field: dims[0].name };
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      if (dims[1]) encoding.color = { field: dims[1].name };
      break;
    }
    case "pie":
    case "donut":
    case "funnel":
    case "waffle": {
      if (dims[0]) encoding.x = { field: dims[0].name };
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      else if (ids[0]) encoding.y = { field: ids[0].name, agg: "count_distinct" };
      else encoding.y = { field: "*", agg: "count" };
      break;
    }
    case "scatter":
    case "bubble":
    case "hexbin": {
      if (measures[0]) encoding.x = { field: measures[0].name };
      if (measures[1]) encoding.y = measureSlot(measures[1]);
      if (chart === "bubble" && measures[2]) encoding.size = measureSlot(measures[2]);
      if (dims[0]) encoding.color = { field: dims[0].name };
      break;
    }
    case "histogram":
    case "density":
    case "ecdf": {
      if (measures[0]) encoding.x = { field: measures[0].name };
      break;
    }
    case "box":
    case "violin":
    case "ridgeline": {
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      if (dims[0]) encoding.x = { field: dims[0].name };
      break;
    }
    case "heatmap":
    case "correlation_matrix": {
      if (dims[0]) encoding.x = { field: dims[0].name };
      if (dims[1]) encoding.y = { field: dims[1].name };
      if (measures[0]) encoding.color = measureSlot(measures[0]);
      else encoding.color = { field: "*", agg: "count" };
      break;
    }
    case "treemap":
    case "sunburst": {
      if (dims[0]) encoding.x = { field: dims[0].name };
      if (dims[1]) encoding.parent = { field: dims[1].name };
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      else encoding.y = { field: "*", agg: "count" };
      break;
    }
    case "sankey":
    case "chord":
    case "network": {
      if (dims[0]) encoding.source = { field: dims[0].name };
      if (dims[1]) encoding.target = { field: dims[1].name };
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      else encoding.y = { field: "*", agg: "count" };
      break;
    }
    case "radar": {
      if (dims[0]) encoding.color = { field: dims[0].name };
      encoding.y = measures.slice(0, maxM).map((m) => measureSlot(m));
      break;
    }
    case "candlestick": {
      if (times[0]) encoding.x = { field: times[0].name };
      const ms = measures.slice(0, 4).map((m) => measureSlot(m));
      encoding.y = ms;
      break;
    }
    case "choropleth":
    case "point_map":
    case "bubble_map":
    case "heat_map":
    case "flow_map": {
      if (geos[0]) encoding.x = { field: geos[0].name };
      if (chart === "point_map" || chart === "bubble_map" || chart === "flow_map") {
        const lat = geos.find((g) => /lat/i.test(g.name));
        const lng = geos.find((g) => /lon|lng/i.test(g.name));
        if (lat) encoding.x = { field: lat.name };
        if (lng) encoding.y = { field: lng.name };
      }
      if (measures[0]) {
        if (chart === "choropleth" || chart === "heat_map") {
          encoding.color = measureSlot(measures[0]);
        } else if (chart === "bubble_map") {
          encoding.size = measureSlot(measures[0]);
        }
      }
      break;
    }
    case "kpi":
    case "big_number":
    case "gauge":
    case "progress": {
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      else if (ids[0]) encoding.y = { field: ids[0].name, agg: "count_distinct" };
      else encoding.y = { field: "*", agg: "count" };
      break;
    }
    case "table":
    case "pivot_table":
    case "parallel_coordinates":
    case "tree":
    case "dendrogram":
    case "marimekko":
    case "bullet":
    default: {
      if (dims[0]) encoding.x = { field: dims[0].name };
      if (measures[0]) encoding.y = measureSlot(measures[0]);
      break;
    }
  }

  return { chart, encoding };
}

function measureSlot(field: EncodableField): SlotField {
  return { field: field.name, agg: chooseAgg(field) };
}
