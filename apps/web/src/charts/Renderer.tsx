import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ComputedChart, SeriesStats } from "./types.js";
import { specToOption } from "./toEChartsOption.js";

/**
 * Thin React wrapper around ECharts. Recomputes the option whenever
 * the input changes, then either initializes or applies it to the
 * existing instance. Disposes on unmount.
 *
 * Deterministic: the same `computed` and `stats` always produce the
 * same option (assuming `specToOption` is pure, which it is).
 */
export interface ChartRendererProps {
  computed: ComputedChart;
  /** Optional series stats overlay (anomaly band, forecast extension). */
  stats?: SeriesStats;
  /** Display height in pixels. */
  height?: number;
}

export function ChartRenderer({ computed, stats, height = 360 }: ChartRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!instanceRef.current) instanceRef.current = echarts.init(el);
    const option = specToOption(computed, stats);
    instanceRef.current.setOption(option, { notMerge: true });
  }, [computed, stats]);

  useEffect(() => {
    const onResize = () => instanceRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
