import { useState } from "react";
import type { SeriesStats } from "./types.js";

/**
 * Toggle for stats overlays (anomaly band, forecast). Computes the
 * stats on demand by calling /charts/series-stats.
 *
 * Deterministic: the API endpoint runs STL + MAD + Holt-Winters from
 * @reports/core, which are pure functions of the input series.
 */
export interface StatsOverlayProps {
  values: number[];
  labels?: string[];
  onStats: (stats: SeriesStats | null) => void;
}

export function StatsOverlay({ values, labels, onStats }: StatsOverlayProps) {
  const [enabled, setEnabled] = useState(false);
  const [period, setPeriod] = useState<number>(0);
  const [horizon, setHorizon] = useState<number>(12);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/charts/series-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, labels, period, horizon }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const stats = (await res.json()) as SeriesStats;
      onStats(stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      onStats(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset style={{ marginTop: "1rem" }}>
      <legend>Stats overlays</legend>
      <label style={{ marginRight: "1rem" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked) onStats(null);
          }}
        />{" "}
        compute anomalies + forecast (deterministic)
      </label>
      {enabled && (
        <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
          <label>
            period:{" "}
            <input
              type="number"
              min={0}
              max={365}
              value={period}
              onChange={(e) => setPeriod(Number.parseInt(e.target.value, 10) || 0)}
              style={{ width: 60 }}
            />
          </label>
          <label>
            horizon:{" "}
            <input
              type="number"
              min={0}
              max={365}
              value={horizon}
              onChange={(e) => setHorizon(Number.parseInt(e.target.value, 10) || 0)}
              style={{ width: 60 }}
            />
          </label>
          <button onClick={() => void run()} disabled={busy || values.length < 4}>
            {busy ? "Running..." : "Run"}
          </button>
          {error && <span style={{ color: "crimson" }}>{error}</span>}
        </span>
      )}
    </fieldset>
  );
}
