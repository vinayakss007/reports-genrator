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

const SAMPLE_PROFILES: Record<string, unknown> = {
  "Time + measure (trend)": {
    fields: [
      { name: "order_date", type: "datetime", isTemporal: true },
      { name: "revenue", type: "number" },
    ],
    rowCount: 12000,
  },
  "Category + measure (compare)": {
    fields: [
      { name: "region", type: "string", cardinality: 5 },
      { name: "revenue", type: "number" },
    ],
    intent: "compare",
  },
  "Two measures (relationship)": {
    fields: [
      { name: "ad_spend", type: "number" },
      { name: "revenue", type: "number" },
      { name: "clicks", type: "integer" },
    ],
  },
  "Geo region + measure": {
    fields: [
      { name: "country", type: "geo", semantic: "geo_region", isGeo: true },
      { name: "users", type: "integer" },
    ],
    intent: "geo",
  },
};

export function App() {
  const [selected, setSelected] = useState<string>("Time + measure (trend)");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const profile = SAMPLE_PROFILES[selected];
      const res = await fetch("/api/recommend-chart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setResult((await res.json()) as RecommendationResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Reports Generator</h1>
      <p style={{ color: "#555" }}>
        Phase 0 smoke screen. Picks a sample profile and calls{" "}
        <code>/recommend-chart</code>. Works with AI disabled — the
        ranking comes from the deterministic core recommender.
      </p>

      <label style={{ display: "block", marginTop: "1rem" }}>
        Sample profile:&nbsp;
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {Object.keys(SAMPLE_PROFILES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={() => void run()}
        disabled={loading}
        style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
      >
        {loading ? "Asking..." : "Recommend chart"}
      </button>

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {result && (
        <section style={{ marginTop: "1.5rem" }}>
          <p>
            <strong>source:</strong> {result.source}
            {result.fallbackReason ? <> ({result.fallbackReason})</> : null}
          </p>
          <ol>
            {result.recommendations.map((r) => (
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
