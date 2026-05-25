import { useEffect, useMemo, useState } from "react";
import { ChartRenderer } from "./charts/Renderer.js";
import { ChartEditor } from "./charts/Editor.js";
import { StatsOverlay } from "./charts/StatsOverlay.js";
import type {
  ChartSpec,
  ComputedChart,
  Profile,
  SeriesStats,
} from "./charts/types.js";

interface Recommendation {
  chart: string;
  score: number;
  reason: string;
}
interface RecommendationResult {
  recommendations: Recommendation[];
  source: "core" | "ai";
  fallbackReason?: string;
}
interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  profile: Profile;
}

interface PgForm {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  query: string;
}

const EMPTY_PG: PgForm = {
  host: "localhost",
  port: "5432",
  database: "",
  user: "",
  password: "",
  ssl: false,
  query: "SELECT * FROM your_table LIMIT 1000",
};

export function App() {
  const [mode, setMode] = useState<"file" | "postgres">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pg, setPg] = useState<PgForm>(EMPTY_PG);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [computed, setComputed] = useState<ComputedChart | null>(null);
  const [stats, setStats] = useState<SeriesStats | null>(null);

  // Whenever the spec changes, recompute the chart.
  useEffect(() => {
    if (!spec || !preview) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/charts/compute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spec, profile: preview.profile, rows: preview.rows }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `HTTP ${res.status}`);
        }
        const out = (await res.json()) as ComputedChart;
        if (!cancelled) setComputed(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "compute failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, preview]);

  // Numeric series for the stats overlay (first measure, in row order).
  const seriesValues = useMemo<{ values: number[]; labels?: string[] } | null>(() => {
    if (!computed) return null;
    const ySlot = Array.isArray(computed.spec.encoding.y)
      ? computed.spec.encoding.y[0]
      : computed.spec.encoding.y;
    if (!ySlot) return null;
    const yName = ySlot.label ?? (ySlot.agg && ySlot.field !== "*" ? `${ySlot.agg}_${ySlot.field}` : ySlot.agg === "count" ? "count" : ySlot.field);
    const xName = computed.spec.encoding.x?.field;
    const values: number[] = [];
    const labels: string[] = [];
    for (const r of computed.rows) {
      const v = Number(r[yName] ?? r[ySlot.field]);
      if (!Number.isFinite(v)) continue;
      values.push(v);
      if (xName) labels.push(String(r[xName]));
    }
    if (values.length === 0) return null;
    return labels.length === values.length ? { values, labels } : { values };
  }, [computed]);

  async function handleFileFlow() {
    if (!file) {
      setError("pick a CSV or XLSX file first");
      return;
    }
    await runFlow(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!upRes.ok) throw new Error(`upload failed: HTTP ${upRes.status}`);
      const up = (await upRes.json()) as { id: string; kind: "csv" | "xlsx" };

      const srcRes = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: up.kind, name: file.name, uploadId: up.id }),
      });
      if (!srcRes.ok) throw new Error(`source failed: HTTP ${srcRes.status}`);
      const src = (await srcRes.json()) as { id: string };

      const dsRes = await fetch("/api/datasets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: src.id, name: file.name }),
      });
      if (!dsRes.ok) throw new Error(`dataset failed: HTTP ${dsRes.status}`);
      const ds = (await dsRes.json()) as { id: string };
      await previewRecommendEncode(ds.id);
    });
  }

  async function handlePgFlow() {
    await runFlow(async () => {
      const port = Number.parseInt(pg.port, 10);
      if (!Number.isFinite(port)) throw new Error("port must be a number");
      const srcRes = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "postgres",
          name: `${pg.user}@${pg.host}/${pg.database}`,
          connection: {
            host: pg.host,
            port,
            database: pg.database,
            user: pg.user,
            password: pg.password,
            ssl: pg.ssl,
          },
        }),
      });
      if (!srcRes.ok) {
        const body = (await srcRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `source failed: HTTP ${srcRes.status}`);
      }
      const src = (await srcRes.json()) as { id: string };

      const dsRes = await fetch("/api/datasets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: src.id,
          name: "query",
          query: pg.query,
        }),
      });
      if (!dsRes.ok) throw new Error(`dataset failed: HTTP ${dsRes.status}`);
      const ds = (await dsRes.json()) as { id: string };
      await previewRecommendEncode(ds.id);
    });
  }

  async function runFlow(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setPreview(null);
    setRecommendation(null);
    setSpec(null);
    setComputed(null);
    setStats(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  async function previewRecommendEncode(datasetId: string) {
    const pvRes = await fetch(`/api/datasets/${datasetId}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 5000 }),
    });
    if (!pvRes.ok) throw new Error(`preview failed: HTTP ${pvRes.status}`);
    const pv = (await pvRes.json()) as PreviewResult;
    setPreview(pv);

    const recRes = await fetch("/api/recommend-chart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pv.profile),
    });
    if (!recRes.ok) throw new Error(`recommend failed: HTTP ${recRes.status}`);
    const rec = (await recRes.json()) as RecommendationResult;
    setRecommendation(rec);

    const top = rec.recommendations[0];
    if (!top) throw new Error("no recommendations returned");
    const aeRes = await fetch("/api/charts/auto-encode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: pv.profile, chart: top.chart, maxMeasures: 4 }),
    });
    if (!aeRes.ok) throw new Error(`auto-encode failed: HTTP ${aeRes.status}`);
    const initialSpec = (await aeRes.json()) as ChartSpec;
    setSpec(initialSpec);
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 1200,
        margin: "1.5rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>Reports Generator</h1>
      <p style={{ color: "#555" }}>
        Upload a CSV/XLSX or connect Postgres. Pipeline:{" "}
        <em>upload &rarr; source &rarr; dataset &rarr; preview &rarr;
          recommend &rarr; auto-encode &rarr; render</em>. All deterministic.
        AI optional, off by default.
      </p>

      <fieldset style={{ padding: "1rem" }}>
        <legend>Source</legend>
        <label style={{ marginRight: "1rem" }}>
          <input
            type="radio"
            checked={mode === "file"}
            onChange={() => setMode("file")}
          />{" "}
          File (CSV/XLSX)
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "postgres"}
            onChange={() => setMode("postgres")}
          />{" "}
          Postgres
        </label>

        {mode === "file" ? (
          <div style={{ marginTop: "0.75rem" }}>
            <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button
              style={{ marginLeft: "1rem" }}
              disabled={busy || !file}
              onClick={() => void handleFileFlow()}
            >
              {busy ? "Working..." : "Upload & Recommend"}
            </button>
          </div>
        ) : (
          <PgForm pg={pg} setPg={setPg} busy={busy} onSubmit={() => void handlePgFlow()} />
        )}
        {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      </fieldset>

      {preview && recommendation && spec && (
        <section style={{ marginTop: "1.5rem" }}>
          <ChartEditor
            profile={preview.profile}
            recommendations={recommendation.recommendations}
            initialSpec={spec}
            onChange={setSpec}
          />

          {seriesValues && isTimeSeries(spec.chart) && (
            <StatsOverlay
              values={seriesValues.values}
              labels={seriesValues.labels}
              onStats={setStats}
            />
          )}

          <div style={{ marginTop: "1rem", border: "1px solid #e5e7eb", padding: "0.5rem", borderRadius: 6 }}>
            {computed ? (
              <ChartRenderer computed={computed} stats={stats ?? undefined} height={420} />
            ) : (
              <p style={{ color: "#888" }}>Computing chart...</p>
            )}
          </div>

          <Profile preview={preview} recommendation={recommendation} />
        </section>
      )}
    </main>
  );
}

function isTimeSeries(chart: string): boolean {
  return [
    "line",
    "multi_line",
    "area",
    "stacked_area",
    "step_line",
    "sparkline",
    "candlestick",
  ].includes(chart);
}

function PgForm({
  pg,
  setPg,
  busy,
  onSubmit,
}: {
  pg: PgForm;
  setPg: (p: PgForm) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const set = <K extends keyof PgForm>(k: K, v: PgForm[K]) => setPg({ ...pg, [k]: v });
  return (
    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.4rem", maxWidth: 520 }}>
      {(["host", "port", "database", "user"] as const).map((k) => (
        <label
          key={k}
          style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.5rem", alignItems: "center" }}
        >
          <span>{k}</span>
          <input value={pg[k] as string} onChange={(e) => set(k, e.target.value)} />
        </label>
      ))}
      <label style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.5rem", alignItems: "center" }}>
        <span>password</span>
        <input type="password" value={pg.password} onChange={(e) => set("password", e.target.value)} />
      </label>
      <label style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.5rem", alignItems: "center" }}>
        <span>ssl</span>
        <input type="checkbox" checked={pg.ssl} onChange={(e) => set("ssl", e.target.checked)} />
      </label>
      <label style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.5rem", alignItems: "center" }}>
        <span>query</span>
        <textarea
          rows={3}
          style={{ fontFamily: "ui-monospace, monospace" }}
          value={pg.query}
          onChange={(e) => set("query", e.target.value)}
        />
      </label>
      <button disabled={busy} onClick={onSubmit} style={{ justifySelf: "start", marginTop: "0.5rem" }}>
        {busy ? "Working..." : "Connect & Recommend"}
      </button>
    </div>
  );
}

function Profile({
  preview,
  recommendation,
}: {
  preview: PreviewResult;
  recommendation: RecommendationResult;
}) {
  return (
    <details style={{ marginTop: "1rem" }}>
      <summary>Profile + recommendations ({preview.rows.length} rows)</summary>
      <table style={{ borderCollapse: "collapse", marginTop: "0.5rem", fontSize: 13 }}>
        <thead>
          <tr>
            {["name", "type", "semantic", "cardinality", "null", "temporal", "geo"].map((h) => (
              <th key={h} style={cell}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.profile.fields.map((f) => (
            <tr key={f.name}>
              <td style={cell}>
                <code>{f.name}</code>
              </td>
              <td style={cell}>{f.type}</td>
              <td style={cell}>{f.semantic ?? ""}</td>
              <td style={cell}>{f.cardinality ?? ""}</td>
              <td style={cell}>{f.nullRate != null ? f.nullRate.toFixed(2) : ""}</td>
              <td style={cell}>{f.isTemporal ? "yes" : ""}</td>
              <td style={cell}>{f.isGeo ? "yes" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: "0.75rem", color: "#555" }}>
        recommend source: {recommendation.source}
        {recommendation.fallbackReason ? ` (${recommendation.fallbackReason})` : ""}
      </p>
      <ol>
        {recommendation.recommendations.map((r) => (
          <li key={r.chart}>
            <strong>{r.chart}</strong> &mdash; {r.score.toFixed(2)} &mdash; {r.reason}
          </li>
        ))}
      </ol>
    </details>
  );
}

const cell: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "0.25rem 0.5rem",
  textAlign: "left",
};
