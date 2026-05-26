/**
 * ECharts geo map registration helper.
 *
 * Lazy-loads the world topojson from /maps/world.json on first use of a
 * geo chart type. Once registered the map is available as "world" for
 * choropleth, point_map, bubble_map, heat_map, and flow_map.
 *
 * The topojson file is expected at apps/web/public/maps/world.json.
 * If it's missing (development without the map asset), the fetch will
 * 404 and the caller falls back to a non-geo chart render.
 */

import * as echarts from "echarts";

let registered = false;
let registering: Promise<boolean> | null = null;

export async function ensureWorldMap(): Promise<boolean> {
  if (registered) return true;
  if (registering) return registering;
  registering = doRegister();
  return registering;
}

async function doRegister(): Promise<boolean> {
  try {
    const res = await fetch("/maps/world.json");
    if (!res.ok) return false;
    const json = await res.json();
    echarts.registerMap("world", json as Parameters<typeof echarts.registerMap>[1]);
    registered = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build an ECharts geo option for choropleth / point_map / bubble_map.
 * The caller should first `await ensureWorldMap()` and only call this
 * if it returned true. Falls back to an empty object on failure.
 */
export function geoOption(
  chart: string,
  rows: Record<string, unknown>[],
  geoField: string | undefined,
  measureField: string | undefined,
  colors: string[],
): echarts.EChartsOption {
  if (!geoField) return { series: [] };

  const data = rows.map((r) => ({
    name: String(r[geoField] ?? ""),
    value: measureField ? Number(r[measureField]) || 0 : 1,
  }));

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (chart === "choropleth") {
    return {
      tooltip: { trigger: "item" },
      visualMap: {
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 100,
        calculable: true,
        inRange: { color: colors.length >= 2 ? colors : ["#dbeafe", "#1e3a8a"] },
        left: "left",
        top: "bottom",
      },
      series: [
        {
          type: "map",
          map: "world",
          roam: true,
          data,
          emphasis: { label: { show: true } },
        },
      ],
    };
  }

  if (chart === "bubble_map" || chart === "point_map") {
    return {
      geo: { map: "world", roam: true },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "effectScatter",
          coordinateSystem: "geo",
          data: data.map((d) => ({
            name: d.name,
            value: [0, 0, d.value], // lat/lng would need geocoding
          })),
          symbolSize: (val: number[]) =>
            Math.max(6, Math.min(30, Math.sqrt(Math.abs(val[2] ?? 0)) * 3)),
          itemStyle: { color: colors[0] ?? "#2563eb" },
        },
      ],
    };
  }

  return { series: [] };
}
