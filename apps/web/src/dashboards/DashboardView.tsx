import { useCallback, useEffect, useMemo, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ChartRenderer } from "../charts/Renderer.js";
import type { ChartSpec, ComputedChart } from "../charts/types.js";
import { ExportButtons } from "../exports/ExportButtons.js";

/**
 * Dashboard view + edit.
 *
 *  - Loads a dashboard, then for every tile resolves the dataset,
 *    computes the chart (via /charts/compute), and renders it in a
 *    react-grid-layout cell.
 *  - Dashboard parameters are merged into every tile's filter list
 *    before /charts/compute, giving real cross-filtering.
 *  - Layout edits (drag/resize) are persisted via PUT /dashboards/:id.
 *
 * Pure presentational against the API; deterministic given inputs.
 */

interface Tile {
  id: string;
  title?: string;
  datasetId: string;
  spec: ChartSpec;
  layout: { x: number; y: number; w: number; h: number };
}

interface Parameter {
  name: string;
  field: string;
  op: string;
  value?: unknown;
}

interface Dashboard {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  parameters: Parameter[];
  tiles: Tile[];
}

export function DashboardView({ id, onClose }: { id: string; onClose: () => void }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [computed, setComputed] = useState<Record<string, ComputedChart | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Load the dashboard.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/dashboards/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as Dashboard;
        if (cancelled) return;
        setDash(d);
        const initial: Record<string, string> = {};
        for (const p of d.parameters) {
          initial[p.name] = p.value == null ? "" : String(p.value);
        }
        setParamValues(initial);
      } catch (e) {
        setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Build merged spec per tile based on current param values.
  const mergedSpecs = useMemo(() => {
    if (!dash) return {} as Record<string, { datasetId: string; spec: ChartSpec }>;
    const paramFilters = dash.parameters
      .map((p) => ({
        field: p.field,
        op: p.op,
        value: paramValues[p.name] === "" ? undefined : paramValues[p.name],
      }))
      .filter((f) => f.value !== undefined);
    const out: Record<string, { datasetId: string; spec: ChartSpec }> = {};
    for (const t of dash.tiles) {
      const merged: ChartSpec = {
        ...t.spec,
        filters: [
          ...(t.spec.filters ?? []),
          ...(paramFilters as ChartSpec["filters"] extends infer F ? (F extends Array<infer X> ? X[] : never) : never),
        ],
      };
      out[t.id] = { datasetId: t.datasetId, spec: merged };
    }
    return out;
  }, [dash, paramValues]);

  // Recompute every tile when its merged spec changes.
  useEffect(() => {
    if (!dash) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, ComputedChart | null> = {};
      for (const t of dash.tiles) {
        const m = mergedSpecs[t.id];
        if (!m) continue;
        try {
          // Resolve rows from the dataset on the server (rows: [] + datasetId).
          const res = await fetch("/api/charts/compute", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ datasetId: m.datasetId, spec: m.spec, rows: [] }),
          });
          if (!res.ok) {
            next[t.id] = null;
            continue;
          }
          next[t.id] = (await res.json()) as ComputedChart;
        } catch {
          next[t.id] = null;
        }
      }
      if (!cancelled) setComputed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [dash, mergedSpecs]);

  const onLayoutChange = useCallback(
    async (layout: Layout[]) => {
      if (!dash) return;
      const updatedTiles = dash.tiles.map((t) => {
        const l = layout.find((x) => x.i === t.id);
        if (!l) return t;
        return { ...t, layout: { x: l.x, y: l.y, w: l.w, h: l.h } };
      });
      const next = { ...dash, tiles: updatedTiles };
      setDash(next);
      await fetch(`/api/dashboards/${dash.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tiles: updatedTiles }),
      });
    },
    [dash],
  );

  if (error) return <p style={{ color: "crimson" }}>Error: {error}</p>;
  if (!dash) return <p>Loading...</p>;

  const layout: Layout[] = dash.tiles.map((t) => ({
    i: t.id,
    x: t.layout.x,
    y: t.layout.y,
    w: t.layout.w,
    h: t.layout.h,
    minW: 2,
    minH: 2,
  }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
        <button onClick={onClose}>&larr; Back</button>
        <h2 style={{ margin: 0 }}>{dash.name}</h2>
        <ExportButtons
          serverTarget={{ kind: "dashboard", dashboardId: dash.id }}
          getEChartsInstance={null}
          filenameStem={dash.name}
        />
      </div>

      {dash.parameters.length > 0 && (
        <fieldset style={{ padding: "0.5rem", marginBottom: "0.75rem" }}>
          <legend>Parameters</legend>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {dash.parameters.map((p) => (
              <label key={p.name} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: "#666" }}>
                  ({p.field} {p.op})
                </span>
                <input
                  value={paramValues[p.name] ?? ""}
                  onChange={(e) => setParamValues({ ...paramValues, [p.name]: e.target.value })}
                  placeholder="(any)"
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <GridLayout
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={48}
        width={1180}
        onLayoutChange={(l) => void onLayoutChange(l)}
        draggableHandle=".tile-handle"
      >
        {dash.tiles.map((t) => (
          <div
            key={t.id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              className="tile-handle"
              style={{
                cursor: "grab",
                padding: "0.25rem 0.5rem",
                fontSize: 12,
                fontWeight: 600,
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              {t.title ?? t.spec.chart}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {computed[t.id] ? (
                <ChartRenderer computed={computed[t.id]!} height={undefined} />
              ) : (
                <p style={{ padding: "0.5rem", color: "#888" }}>computing...</p>
              )}
            </div>
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
