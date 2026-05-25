import type { ComputedChart, SeriesStats, SlotField } from "./types.js";

/**
 * Deterministic ChartSpec -> ECharts option mapper.
 *
 * Same `computed` + `stats` -> same option. No randomness, no AI.
 *
 * Covers all chart types in the recommender: bar/column/line/area/
 * pie/donut/scatter/bubble/histogram/box/heatmap/treemap/sunburst/
 * sankey/radar/candlestick/gauge/kpi/big_number/funnel/parallel/
 * correlation_matrix/table/pivot_table.
 *
 * For chart types that ECharts doesn't render directly (table,
 * pivot_table, kpi, big_number) the renderer falls back to a simple
 * grid layout with no series, since those are rendered by separate
 * components in the page.
 */
export function specToOption(computed: ComputedChart, stats?: SeriesStats): echarts.EChartsOption {
  const { spec, rows, colors } = computed;
  const enc = spec.encoding;
  const ySlots = ySlotsArray(enc.y);
  const xField = enc.x?.field;
  const colorField = enc.color?.field;

  const baseGrid = { left: 60, right: 24, top: 30, bottom: 50, containLabel: true };

  switch (spec.chart) {
    case "line":
    case "area":
    case "step_line":
    case "stacked_area":
    case "multi_line":
      return lineOrArea(spec.chart, rows, xField, ySlots, colorField, colors, baseGrid, stats);

    case "sparkline":
      return sparkline(rows, xField, ySlots, colors);

    case "bar":
    case "column":
    case "lollipop":
      return bar(spec.chart, rows, xField, ySlots, colors, baseGrid);

    case "grouped_bar":
    case "stacked_bar":
    case "stacked_bar_100":
      return groupedBar(spec.chart, rows, xField, ySlots, colorField, colors, baseGrid);

    case "pie":
    case "donut":
      return pie(spec.chart, rows, xField, ySlots, colors);

    case "funnel":
      return funnel(rows, xField, ySlots, colors);

    case "scatter":
    case "bubble":
      return scatter(spec.chart, rows, xField, ySlots, enc.size, colorField, colors, baseGrid);

    case "histogram":
      return histogram(rows, xField, colors, baseGrid);

    case "box":
      return box(rows, xField, ySlots, colors, baseGrid);

    case "heatmap":
    case "correlation_matrix":
      return heatmap(rows, xField, enc.y, colors, baseGrid);

    case "treemap":
      return treemap(rows, xField, ySlots, enc.parent, colors);

    case "sunburst":
      return sunburst(rows, xField, ySlots, enc.parent, colors);

    case "sankey":
      return sankey(rows, enc.source, enc.target, ySlots, colors);

    case "radar":
      return radar(rows, ySlots, colorField, colors);

    case "candlestick":
      return candlestick(rows, xField, ySlots, colors, baseGrid);

    case "gauge":
    case "progress":
      return gauge(rows, ySlots, colors);

    case "parallel_coordinates":
      return parallel(rows, ySlots, colors);

    default:
      // Fallback: generic xy if data shape allows.
      return lineOrArea("bar", rows, xField, ySlots, colorField, colors, baseGrid, undefined);
  }
}

// ----- helpers -----

function ySlotsArray(y: ComputedChart["spec"]["encoding"]["y"]): SlotField[] {
  if (!y) return [];
  if (Array.isArray(y)) return y;
  return [y];
}

function fieldName(s: SlotField | undefined): string {
  if (!s) return "";
  return s.label ?? (s.agg && s.field !== "*" ? `${s.agg}_${s.field}` : s.agg === "count" ? "count" : s.field);
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ----- chart builders -----

function lineOrArea(
  kind: string,
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colorField: string | undefined,
  colors: string[],
  grid: object,
  stats?: SeriesStats,
): echarts.EChartsOption {
  const xs = xField ? rows.map((r) => r[xField]) : rows.map((_r, i) => i);

  const series: echarts.SeriesOption[] = [];

  if (colorField) {
    // Long-format: split into series by colorField, one numeric measure.
    const measure = ySlots[0];
    const groups = new Map<string, [unknown, number | null][]>();
    for (const r of rows) {
      const k = String(r[colorField] ?? "");
      const arr = groups.get(k) ?? [];
      arr.push([r[xField ?? ""], num(r[fieldName(measure)] ?? r[measure?.field ?? ""])]);
      groups.set(k, arr);
    }
    let i = 0;
    for (const [k, pairs] of groups) {
      series.push({
        name: k,
        type: "line",
        smooth: kind !== "step_line",
        step: kind === "step_line" ? "end" : false,
        areaStyle: kind === "area" || kind === "stacked_area" ? {} : undefined,
        stack: kind === "stacked_area" ? "stack" : undefined,
        data: pairs.map(([, v]) => v),
        itemStyle: { color: colors[i % colors.length] },
      });
      i += 1;
    }
  } else {
    let i = 0;
    for (const ys of ySlots) {
      series.push({
        name: ys.label ?? ys.field,
        type: "line",
        smooth: kind !== "step_line",
        step: kind === "step_line" ? "end" : false,
        areaStyle: kind === "area" || kind === "stacked_area" ? {} : undefined,
        stack: kind === "stacked_area" ? "stack" : undefined,
        data: rows.map((r) => num(r[fieldName(ys)] ?? r[ys.field])),
        itemStyle: { color: colors[i % colors.length] },
      });
      i += 1;
    }
  }

  if (stats?.forecast) {
    const histLen = stats.values.length;
    const horizon = stats.forecast.forecast.length;
    const padded: (number | null)[] = new Array(histLen).fill(null).concat(stats.forecast.forecast);
    series.push({
      name: "forecast",
      type: "line",
      lineStyle: { type: "dashed" },
      data: padded as number[],
      itemStyle: { color: colors[1] ?? "#888" },
    });
    void horizon;
  }
  if (stats?.anomalies) {
    const dots = stats.anomalies
      .filter((a) => a.isAnomaly)
      .map((a) => [xs[a.index] ?? a.index, a.value] as [unknown, number]);
    if (dots.length > 0) {
      series.push({
        name: "anomalies",
        type: "scatter",
        symbolSize: 10,
        data: dots as unknown as number[][],
        itemStyle: { color: "#dc2626" },
      });
    }
  }

  return {
    grid,
    tooltip: { trigger: "axis" },
    legend: series.length > 1 ? { top: 0 } : undefined,
    xAxis: { type: xField ? "category" : "value", data: xField ? xs.map(String) : undefined },
    yAxis: { type: "value" },
    series,
  };
}

function sparkline(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colors: string[],
): echarts.EChartsOption {
  const xs = xField ? rows.map((r) => String(r[xField])) : rows.map((_r, i) => String(i));
  const m = ySlots[0];
  return {
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: "category", data: xs, show: false, boundaryGap: false },
    yAxis: { type: "value", show: false },
    series: [
      {
        type: "line",
        smooth: true,
        showSymbol: false,
        areaStyle: {},
        data: rows.map((r) => num(r[fieldName(m)] ?? r[m?.field ?? ""])),
        itemStyle: { color: colors[0] ?? "#2563eb" },
      },
    ],
  };
}

function bar(
  kind: string,
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  const m = ySlots[0];
  const data = rows.map((r) => num(r[fieldName(m)] ?? r[m?.field ?? ""]));
  return {
    grid,
    tooltip: { trigger: "axis" },
    xAxis:
      kind === "bar"
        ? { type: "value" }
        : { type: "category", data: rows.map((r) => String(r[xField ?? ""])) },
    yAxis:
      kind === "bar"
        ? { type: "category", data: rows.map((r) => String(r[xField ?? ""])) }
        : { type: "value" },
    series: [
      {
        type: kind === "lollipop" ? "scatter" : "bar",
        data,
        itemStyle: { color: colors[0] ?? "#2563eb" },
        symbolSize: kind === "lollipop" ? 10 : undefined,
      },
    ],
  };
}

function groupedBar(
  kind: string,
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colorField: string | undefined,
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  const m = ySlots[0];
  const xs = Array.from(new Set(rows.map((r) => String(r[xField ?? ""]))));
  const groups = colorField ? Array.from(new Set(rows.map((r) => String(r[colorField]).trim()))) : ["value"];

  const series: echarts.SeriesOption[] = groups.map((g, i) => ({
    name: g,
    type: "bar",
    stack: kind === "grouped_bar" ? undefined : "stack",
    data: xs.map((x) => {
      const row = rows.find((r) => {
        if (String(r[xField ?? ""]) !== x) return false;
        if (colorField) return String(r[colorField]) === g;
        return true;
      });
      return row ? num(row[fieldName(m)] ?? row[m?.field ?? ""]) : null;
    }),
    itemStyle: { color: colors[i % colors.length] },
  }));

  if (kind === "stacked_bar_100") {
    // Normalize per x to 100. Done in the data array above is too late; mutate here.
    for (let i = 0; i < xs.length; i++) {
      let total = 0;
      for (const s of series) {
        const v = (s.data as (number | null)[])[i];
        if (typeof v === "number") total += v;
      }
      if (total > 0) {
        for (const s of series) {
          const arr = s.data as (number | null)[];
          if (typeof arr[i] === "number") arr[i] = ((arr[i] as number) / total) * 100;
        }
      }
    }
  }

  return {
    grid,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0 },
    xAxis: { type: "category", data: xs },
    yAxis: { type: "value", max: kind === "stacked_bar_100" ? 100 : undefined },
    series,
  };
}

function pie(
  kind: string,
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colors: string[],
): echarts.EChartsOption {
  const m = ySlots[0];
  return {
    tooltip: { trigger: "item" },
    legend: { top: 0 },
    series: [
      {
        type: "pie",
        radius: kind === "donut" ? ["45%", "70%"] : "70%",
        data: rows.map((r, i) => ({
          name: String(r[xField ?? ""]),
          value: num(r[fieldName(m)] ?? r[m?.field ?? ""]) ?? 0,
          itemStyle: { color: colors[i % colors.length] },
        })),
      },
    ],
  };
}

function funnel(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colors: string[],
): echarts.EChartsOption {
  const m = ySlots[0];
  return {
    tooltip: { trigger: "item" },
    legend: { top: 0 },
    series: [
      {
        type: "funnel",
        sort: "descending",
        data: rows.map((r, i) => ({
          name: String(r[xField ?? ""]),
          value: num(r[fieldName(m)] ?? r[m?.field ?? ""]) ?? 0,
          itemStyle: { color: colors[i % colors.length] },
        })),
      },
    ],
  };
}

function scatter(
  kind: string,
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  size: SlotField | undefined,
  colorField: string | undefined,
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  const yField = ySlots[0]?.field ?? "";
  const sf = size?.field;
  const groups = new Map<string, [number, number, number?][]>();
  for (const r of rows) {
    const x = num(r[xField ?? ""]);
    const y = num(r[yField]);
    if (x === null || y === null) continue;
    const sz = sf ? num(r[sf]) ?? undefined : undefined;
    const key = colorField ? String(r[colorField]) : "_all";
    const arr = groups.get(key) ?? [];
    if (sz != null) arr.push([x, y, sz]);
    else arr.push([x, y]);
    groups.set(key, arr);
  }
  const series: echarts.SeriesOption[] = [];
  let i = 0;
  for (const [k, data] of groups) {
    series.push({
      name: k === "_all" ? undefined : k,
      type: "scatter",
      symbolSize: kind === "bubble" && sf
        ? (val: number[]) => {
            const v = val[2] ?? 0;
            return Math.max(6, Math.min(40, Math.sqrt(Math.abs(v)) * 4));
          }
        : 8,
      data,
      itemStyle: { color: colors[i % colors.length] },
    });
    i += 1;
  }
  return {
    grid,
    tooltip: { trigger: "item" },
    legend: groups.size > 1 ? { top: 0 } : undefined,
    xAxis: { type: "value", name: xField },
    yAxis: { type: "value", name: yField },
    series,
  };
}

function histogram(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  const values: number[] = [];
  for (const r of rows) {
    const v = num(r[xField ?? ""]);
    if (v !== null) values.push(v);
  }
  const bins = freedmanDiaconisBins(values);
  const counts = bins.map(() => 0);
  for (const v of values) {
    let idx = Math.floor((v - bins[0]!.lo) / (bins[0]!.hi - bins[0]!.lo + 1e-12));
    if (idx < 0) idx = 0;
    if (idx >= bins.length) idx = bins.length - 1;
    counts[idx]! += 1;
  }
  return {
    grid,
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: bins.map((b) => `${b.lo.toFixed(2)}–${b.hi.toFixed(2)}`) },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: counts, itemStyle: { color: colors[0] ?? "#2563eb" }, barWidth: "98%" }],
  };
}

function box(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  const yField = ySlots[0]?.field ?? "";
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const v = num(r[yField]);
    if (v === null) continue;
    const k = xField ? String(r[xField]) : "all";
    const arr = groups.get(k) ?? [];
    arr.push(v);
    groups.set(k, arr);
  }
  const labels: string[] = [];
  const data: number[][] = [];
  for (const [k, vs] of groups) {
    labels.push(k);
    data.push(boxStats(vs));
  }
  return {
    grid,
    tooltip: { trigger: "item" },
    xAxis: { type: "category", data: labels },
    yAxis: { type: "value" },
    series: [{ type: "boxplot", data, itemStyle: { color: colors[0] ?? "#2563eb" } }],
  };
}

function heatmap(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  yEnc: ComputedChart["spec"]["encoding"]["y"],
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  const yField = Array.isArray(yEnc) ? yEnc[0]?.field ?? "" : (yEnc as SlotField | undefined)?.field ?? "";
  const xs = Array.from(new Set(rows.map((r) => String(r[xField ?? ""]))));
  const ys = Array.from(new Set(rows.map((r) => String(r[yField]))));
  const data: [number, number, number][] = [];
  let max = -Infinity;
  let min = Infinity;
  for (const r of rows) {
    const x = xs.indexOf(String(r[xField ?? ""]));
    const y = ys.indexOf(String(r[yField]));
    const v = num(r["value"] ?? r["count"] ?? r["sum"]) ?? 0;
    data.push([x, y, v]);
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return {
    grid,
    tooltip: { position: "top" },
    xAxis: { type: "category", data: xs },
    yAxis: { type: "category", data: ys },
    visualMap: {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: colors.length > 0 ? colors : ["#dbeafe", "#1e3a8a"] },
    },
    series: [
      {
        type: "heatmap",
        data,
        emphasis: { itemStyle: { shadowBlur: 8 } },
      },
    ],
  };
}

function treemap(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  parent: SlotField | undefined,
  colors: string[],
): echarts.EChartsOption {
  const m = ySlots[0];
  const data = parent
    ? hierarchical(rows, parent.field, xField ?? "", fieldName(m))
    : rows.map((r, i) => ({
        name: String(r[xField ?? ""]),
        value: num(r[fieldName(m)] ?? r[m?.field ?? ""]) ?? 0,
        itemStyle: { color: colors[i % colors.length] },
      }));
  return { tooltip: {}, series: [{ type: "treemap", data }] };
}

function sunburst(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  parent: SlotField | undefined,
  colors: string[],
): echarts.EChartsOption {
  const m = ySlots[0];
  const data = parent
    ? hierarchical(rows, parent.field, xField ?? "", fieldName(m))
    : rows.map((r, i) => ({
        name: String(r[xField ?? ""]),
        value: num(r[fieldName(m)] ?? r[m?.field ?? ""]) ?? 0,
        itemStyle: { color: colors[i % colors.length] },
      }));
  return { tooltip: {}, series: [{ type: "sunburst", data, radius: [0, "90%"] }] };
}

function sankey(
  rows: Record<string, unknown>[],
  source: SlotField | undefined,
  target: SlotField | undefined,
  ySlots: SlotField[],
  colors: string[],
): echarts.EChartsOption {
  if (!source || !target) return { series: [] };
  const m = ySlots[0];
  const nodes = new Set<string>();
  const links: { source: string; target: string; value: number }[] = [];
  for (const r of rows) {
    const s = String(r[source.field]);
    const t = String(r[target.field]);
    nodes.add(s);
    nodes.add(t);
    const v = num(r[fieldName(m)] ?? r[m?.field ?? ""]) ?? 1;
    links.push({ source: s, target: t, value: v });
  }
  return {
    tooltip: { trigger: "item", triggerOn: "mousemove" },
    series: [
      {
        type: "sankey",
        data: Array.from(nodes).map((n, i) => ({ name: n, itemStyle: { color: colors[i % colors.length] } })),
        links,
        emphasis: { focus: "adjacency" },
      },
    ],
  };
}

function radar(
  rows: Record<string, unknown>[],
  ySlots: SlotField[],
  colorField: string | undefined,
  colors: string[],
): echarts.EChartsOption {
  const indicators = ySlots.map((m) => ({ name: m.label ?? m.field }));
  let series: echarts.SeriesOption[] = [];
  if (colorField) {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const k = String(r[colorField]);
      const v: number[] = ySlots.map((m) => num(r[fieldName(m)] ?? r[m.field]) ?? 0);
      groups.set(k, v);
    }
    series = [
      {
        type: "radar",
        data: Array.from(groups, ([k, value], i) => ({
          name: k,
          value,
          itemStyle: { color: colors[i % colors.length] },
        })),
      },
    ];
  } else {
    series = [
      {
        type: "radar",
        data: rows.map((r, i) => ({
          name: String(i),
          value: ySlots.map((m) => num(r[fieldName(m)] ?? r[m.field]) ?? 0),
          itemStyle: { color: colors[i % colors.length] },
        })),
      },
    ];
  }
  return { tooltip: {}, legend: { top: 0 }, radar: { indicator: indicators }, series };
}

function candlestick(
  rows: Record<string, unknown>[],
  xField: string | undefined,
  ySlots: SlotField[],
  colors: string[],
  grid: object,
): echarts.EChartsOption {
  // Expects 4 measures in OHLC order.
  const data = rows.map((r) =>
    ySlots.slice(0, 4).map((m) => num(r[fieldName(m)] ?? r[m.field]) ?? 0),
  );
  return {
    grid,
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: rows.map((r) => String(r[xField ?? ""])) },
    yAxis: { type: "value" },
    series: [
      {
        type: "candlestick",
        data,
        itemStyle: {
          color: colors[2] ?? "#16a34a",
          color0: colors[1] ?? "#dc2626",
          borderColor: colors[2] ?? "#16a34a",
          borderColor0: colors[1] ?? "#dc2626",
        },
      },
    ],
  };
}

function gauge(
  rows: Record<string, unknown>[],
  ySlots: SlotField[],
  colors: string[],
): echarts.EChartsOption {
  const v = num(rows[0]?.[fieldName(ySlots[0])] ?? rows[0]?.[ySlots[0]?.field ?? ""]) ?? 0;
  return {
    series: [
      {
        type: "gauge",
        data: [{ value: v, name: ySlots[0]?.field ?? "" }],
        progress: { show: true },
        axisLine: { lineStyle: { color: [[1, colors[0] ?? "#2563eb"]] } },
      },
    ],
  };
}

function parallel(
  rows: Record<string, unknown>[],
  ySlots: SlotField[],
  colors: string[],
): echarts.EChartsOption {
  const dims = ySlots.map((m, i) => ({ dim: i, name: m.label ?? m.field }));
  const data = rows.map((r) => ySlots.map((m) => num(r[fieldName(m)] ?? r[m.field]) ?? 0));
  return {
    parallelAxis: dims,
    series: [
      {
        type: "parallel",
        data,
        lineStyle: { color: colors[0] ?? "#2563eb", opacity: 0.6 },
      },
    ],
  };
}

// ----- pure utilities -----

function freedmanDiaconisBins(values: number[]): { lo: number; hi: number }[] {
  if (values.length === 0) return [{ lo: 0, hi: 1 }];
  const sorted = values.slice().sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  const iqr = Math.max(q3 - q1, 1e-9);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const width = (2 * iqr) / Math.cbrt(sorted.length);
  const count = Math.max(5, Math.min(50, Math.ceil((max - min) / width)));
  const step = (max - min) / count || 1;
  const bins: { lo: number; hi: number }[] = [];
  for (let i = 0; i < count; i++) bins.push({ lo: min + i * step, hi: min + (i + 1) * step });
  return bins;
}

function boxStats(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
  return [sorted[0]!, q(0.25), q(0.5), q(0.75), sorted[sorted.length - 1]!];
}

function hierarchical(
  rows: Record<string, unknown>[],
  parentField: string,
  nameField: string,
  valueField: string,
) {
  const map = new Map<string, { name: string; value: number; children: ReturnType<typeof Object.create>[] }>();
  for (const r of rows) {
    const p = String(r[parentField] ?? "root");
    const n = String(r[nameField]);
    const v = num(r[valueField]) ?? 0;
    const parent = map.get(p) ?? { name: p, value: 0, children: [] };
    parent.children.push({ name: n, value: v });
    map.set(p, parent);
  }
  return Array.from(map.values());
}
