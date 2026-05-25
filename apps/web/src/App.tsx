import { useState } from "react";

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
interface FieldProfile {
  name: string;
  type: string;
  semantic?: string;
  cardinality?: number;
  nullRate?: number;
  isTemporal?: boolean;
  isGeo?: boolean;
}
interface Profile {
  fields: FieldProfile[];
  rowCount?: number;
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

  async function handleFileFlow() {
    if (!file) {
      setError("pick a CSV or XLSX file first");
      return;
    }
    setBusy(true);
    setError(null);
    setPreview(null);
    setRecommendation(null);
    try {
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

      await previewAndRecommend(ds.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePgFlow() {
    setBusy(true);
    setError(null);
    setPreview(null);
    setRecommendation(null);
    try {
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

      await previewAndRecommend(ds.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  }

  async function previewAndRecommend(datasetId: string) {
    const pvRes = await fetch(`/api/datasets/${datasetId}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1000 }),
    });
    if (!pvRes.ok) {
      const body = (await pvRes.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `preview failed: HTTP ${pvRes.status}`);
    }
    const pv = (await pvRes.json()) as PreviewResult;
    setPreview(pv);

    const recRes = await fetch("/api/recommend-chart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pv.profile),
    });
    if (!recRes.ok) throw new Error(`recommend failed: HTTP ${recRes.status}`);
    setRecommendation((await recRes.json()) as RecommendationResult);
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 960,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>Reports Generator</h1>
      <p style={{ color: "#555" }}>
        Upload a CSV/XLSX or connect Postgres. The pipeline runs in
        order: <em>upload → source → dataset → preview → recommend</em>.
        All deterministic. AI is optional and disabled by default.
      </p>

      <fieldset style={{ marginTop: "1rem", padding: "1rem" }}>
        <legend>Source</legend>

        <label style={{ marginRight: "1rem" }}>
          <input
            type="radio"
            name="mode"
            checked={mode === "file"}
            onChange={() => setMode("file")}
          />{" "}
          File (CSV / XLSX)
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "postgres"}
            onChange={() => setMode("postgres")}
          />{" "}
          Postgres
        </label>

        {mode === "file" ? (
          <div style={{ marginTop: "1rem" }}>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              style={{ marginLeft: "1rem", padding: "0.4rem 0.8rem" }}
              disabled={busy || !file}
              onClick={() => void handleFileFlow()}
            >
              {busy ? "Working..." : "Upload & Recommend"}
            </button>
          </div>
        ) : (
          <PostgresForm pg={pg} setPg={setPg} busy={busy} onSubmit={() => void handlePgFlow()} />
        )}

        {error && <p style={{ color: "crimson", marginTop: "1rem" }}>Error: {error}</p>}
      </fieldset>

      {preview && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Profile</h2>
          <p style={{ color: "#555" }}>
            {preview.rows.length} rows
            {preview.truncated ? " (truncated)" : ""} · {preview.columns.length} columns
          </p>
          <table style={profileTableStyle}>
            <thead>
              <tr>
                {[
                  "name",
                  "type",
                  "semantic",
                  "cardinality",
                  "null rate",
                  "temporal",
                  "geo",
                ].map((h) => (
                  <th key={h} style={cellStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.profile.fields.map((f) => (
                <tr key={f.name}>
                  <td style={cellStyle}>
                    <code>{f.name}</code>
                  </td>
                  <td style={cellStyle}>{f.type}</td>
                  <td style={cellStyle}>{f.semantic ?? ""}</td>
                  <td style={cellStyle}>{f.cardinality ?? ""}</td>
                  <td style={cellStyle}>
                    {f.nullRate != null ? f.nullRate.toFixed(2) : ""}
                  </td>
                  <td style={cellStyle}>{f.isTemporal ? "yes" : ""}</td>
                  <td style={cellStyle}>{f.isGeo ? "yes" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {recommendation && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Recommended charts</h2>
          <p style={{ color: "#555" }}>
            <strong>source:</strong> {recommendation.source}
            {recommendation.fallbackReason ? ` (${recommendation.fallbackReason})` : null}
          </p>
          <ol>
            {recommendation.recommendations.map((r) => (
              <li key={r.chart}>
                <strong>{r.chart}</strong> — score {r.score.toFixed(2)} — {r.reason}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

function PostgresForm({
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
  const setField = <K extends keyof PgForm>(k: K, v: PgForm[K]) => setPg({ ...pg, [k]: v });
  return (
    <div style={{ marginTop: "1rem", display: "grid", gap: "0.5rem", maxWidth: 520 }}>
      <Row label="host">
        <input value={pg.host} onChange={(e) => setField("host", e.target.value)} />
      </Row>
      <Row label="port">
        <input value={pg.port} onChange={(e) => setField("port", e.target.value)} />
      </Row>
      <Row label="database">
        <input value={pg.database} onChange={(e) => setField("database", e.target.value)} />
      </Row>
      <Row label="user">
        <input value={pg.user} onChange={(e) => setField("user", e.target.value)} />
      </Row>
      <Row label="password">
        <input
          type="password"
          value={pg.password}
          onChange={(e) => setField("password", e.target.value)}
        />
      </Row>
      <Row label="ssl">
        <input
          type="checkbox"
          checked={pg.ssl}
          onChange={(e) => setField("ssl", e.target.checked)}
        />
      </Row>
      <Row label="query">
        <textarea
          rows={3}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
          value={pg.query}
          onChange={(e) => setField("query", e.target.value)}
        />
      </Row>
      <button
        style={{ marginTop: "0.5rem", padding: "0.4rem 0.8rem", justifySelf: "start" }}
        disabled={busy}
        onClick={onSubmit}
      >
        {busy ? "Working..." : "Connect & Recommend"}
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.5rem", alignItems: "center" }}>
      <span>{label}</span>
      <span>{children}</span>
    </label>
  );
}

const profileTableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  marginTop: "0.5rem",
  fontSize: 14,
};
const cellStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  padding: "0.25rem 0.5rem",
  textAlign: "left",
};
