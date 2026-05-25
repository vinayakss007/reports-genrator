import type {
  ChartType,
  Field,
  Profile,
  Recommendation,
} from "@reports/shared";
import { inferRoles } from "./roles.js";

/**
 * Deterministic, rule-based chart recommender.
 *
 * Pure function. Same input → same output. No randomness, no I/O, no AI.
 * This is the system of record; the AI gateway can only ever reorder /
 * annotate this output.
 */
export function recommendChart(profile: Profile): Recommendation[] {
  const fields = inferRoles(profile.fields);
  const measures = fields.filter((f) => f.role === "measure");
  const dims = fields.filter((f) => f.role === "dimension");
  const times = fields.filter((f) => f.role === "time");
  const geos = fields.filter((f) => f.role === "geo");

  const out: Recommendation[] = [];
  const intent = profile.intent ?? "auto";

  // --- Geo
  if (geos.length >= 1 && measures.length >= 1) {
    const geo = geos[0]!;
    if (geo.semantic === "geo_point") {
      out.push(rec("point_map", 0.92, `${geo.name} is geo points with measure ${measures[0]!.name}`));
      out.push(rec("bubble_map", 0.85, "geo points with a measure encode size as bubbles"));
    } else {
      out.push(rec("choropleth", 0.92, `${geo.name} is a geo region with measure ${measures[0]!.name}`));
      out.push(rec("bubble_map", 0.7, "geo region with measure can render as bubble map"));
    }
  }

  // --- Trend (time + measure)
  if (times.length >= 1 && measures.length >= 1) {
    const m = measures.length;
    out.push(rec("line", 0.95, `${times[0]!.name} on x with ${m} measure(s) over time`));
    if (m >= 2) out.push(rec("multi_line", 0.9, `${m} measures over time`));
    out.push(rec("area", 0.75, "time + measure also reads well as area"));
    if (m >= 2) out.push(rec("stacked_area", 0.7, `${m} measures stack as area`));
    out.push(rec("bar", 0.6, "time buckets can also display as bars"));
  }

  // --- Comparison (1 cat dim + measure)
  if (dims.length === 1 && measures.length >= 1 && times.length === 0 && geos.length === 0) {
    const d = dims[0]!;
    const card = d.cardinality ?? 0;
    if (card > 0 && card <= 12) {
      out.push(rec("bar", 0.9, `${card} categories of ${d.name} compare well as bars`));
      out.push(rec("column", 0.85, "vertical columns are equivalent for low cardinality"));
      out.push(rec("lollipop", 0.6, "lollipop reduces ink-to-data ratio"));
      if (card <= 6 && (intent === "part_to_whole" || intent === "auto")) {
        out.push(rec("pie", 0.55, `≤ 6 slices of ${d.name} are readable as a pie`));
        out.push(rec("donut", 0.5, "donut is a pie with a center label slot"));
      }
    } else if (card > 12) {
      out.push(rec("bar", 0.85, `top-N horizontal bar handles ${card} categories`));
      out.push(rec("treemap", 0.7, "treemap encodes many categories by area"));
    }
  }

  // --- Two categorical dims + measure
  if (dims.length >= 2 && measures.length >= 1 && times.length === 0) {
    out.push(rec("grouped_bar", 0.8, "two categorical dims group well as bars"));
    out.push(rec("stacked_bar", 0.78, "stacked bar shows part-to-whole per group"));
    out.push(rec("heatmap", 0.72, "two cat dims with a measure encode as heatmap"));
  }

  // --- Relationship (>=2 measures, no time)
  if (measures.length >= 2 && times.length === 0) {
    out.push(rec("scatter", 0.88, `${measures[0]!.name} vs ${measures[1]!.name}`));
    if (measures.length >= 3) {
      out.push(rec("bubble", 0.82, "third measure encodes size"));
    }
    if (measures.length >= 4) {
      out.push(rec("parallel_coordinates", 0.65, `${measures.length} measures benefit from parallel coords`));
    }
    out.push(rec("correlation_matrix", 0.6, "view pairwise correlations across measures"));
  }

  // --- Distribution (1 measure, no dims)
  if (measures.length === 1 && dims.length === 0 && times.length === 0) {
    const m = measures[0]!;
    out.push(rec("histogram", 0.85, `distribution of ${m.name}`));
    out.push(rec("box", 0.7, "box plot summarizes distribution"));
    out.push(rec("kpi", 0.65, "single measure can show as KPI tile"));
    out.push(rec("big_number", 0.6, "headline figure with optional sparkline"));
  }

  // --- Pure tabular fallback
  if (out.length === 0) {
    out.push(rec("table", 0.4, "no rule matched; tabular display is safe"));
    if (measures.length >= 1) out.push(rec("kpi", 0.35, "show first measure as KPI"));
  }

  // Apply intent boosts.
  for (const r of out) {
    r.score = clamp01(r.score * intentBoost(intent, r.chart));
  }

  // Stable sort: score desc, then chart name asc for determinism.
  return dedupe(out).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chart < b.chart ? -1 : a.chart > b.chart ? 1 : 0;
  });
}

function rec(chart: ChartType, score: number, reason: string): Recommendation {
  return { chart, score, reason };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function dedupe(list: Recommendation[]): Recommendation[] {
  const best = new Map<ChartType, Recommendation>();
  for (const r of list) {
    const prev = best.get(r.chart);
    if (!prev || r.score > prev.score) best.set(r.chart, r);
  }
  return [...best.values()];
}

function intentBoost(intent: Profile["intent"], chart: ChartType): number {
  if (!intent || intent === "auto") return 1;
  const map: Record<Exclude<Profile["intent"], undefined | "auto">, ChartType[]> = {
    compare: ["bar", "column", "grouped_bar", "stacked_bar", "lollipop", "radar"],
    trend: ["line", "multi_line", "area", "stacked_area", "step_line", "sparkline", "candlestick"],
    part_to_whole: ["pie", "donut", "treemap", "sunburst", "funnel", "waffle", "stacked_bar_100"],
    distribution: ["histogram", "density", "box", "violin", "ecdf"],
    relationship: ["scatter", "bubble", "hexbin", "heatmap", "correlation_matrix", "parallel_coordinates"],
    hierarchy: ["tree", "sankey", "chord", "network", "treemap", "sunburst"],
    geo: ["choropleth", "point_map", "bubble_map", "heat_map", "flow_map"],
    kpi: ["kpi", "big_number", "gauge", "progress"],
    table: ["table", "pivot_table"],
  };
  const list = intent in map ? map[intent as keyof typeof map] : [];
  if (!list) return 1;
  return list.includes(chart) ? 1.1 : 0.9;
}

// Re-export for callers that want to inspect derived fields.
export type { Field };
