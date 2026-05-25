import { useEffect, useState } from "react";

interface Schedule {
  id: string;
  name: string;
  cron: string;
  format: "csv" | "xlsx" | "json";
  delivery: { kind: "webhook" | "file"; url?: string; dir?: string };
  target: { kind: string; datasetId?: string; dashboardId?: string };
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastMessage?: string;
}

interface DatasetOpt {
  id: string;
  name: string;
}

interface DashboardOpt {
  id: string;
  name: string;
}

export function SchedulesPage() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [datasets, setDatasets] = useState<DatasetOpt[]>([]);
  const [dashboards, setDashboards] = useState<DashboardOpt[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("Daily export");
  const [cronExpr, setCron] = useState("0 9 * * *");
  const [targetKind, setTargetKind] = useState<"dataset" | "dashboard">("dataset");
  const [targetId, setTargetId] = useState<string>("");
  const [format, setFormat] = useState<"csv" | "xlsx" | "json">("csv");
  const [deliveryKind, setDeliveryKind] = useState<"file" | "webhook">("file");
  const [deliveryUrl, setDeliveryUrl] = useState("");
  const [deliveryDir, setDeliveryDir] = useState("daily");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [sr, drr, dsr] = await Promise.all([
        fetch("/api/schedules"),
        fetch("/api/datasets"),
        fetch("/api/dashboards"),
      ]);
      if (sr.ok) setItems((await sr.json()) as Schedule[]);
      if (drr.ok) setDatasets((await drr.json()) as DatasetOpt[]);
      if (dsr.ok) setDashboards((await dsr.json()) as DashboardOpt[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function create() {
    if (!targetId) {
      setError("pick a target");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const target =
        targetKind === "dataset"
          ? { kind: "dataset", datasetId: targetId }
          : { kind: "dashboard", dashboardId: targetId };
      const delivery =
        deliveryKind === "webhook"
          ? { kind: "webhook", url: deliveryUrl }
          : { kind: "file", dir: deliveryDir };
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, cron: cronExpr, target, format, delivery, enabled: true }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function runNow(id: string) {
    await fetch(`/api/schedules/${id}/run-now`, { method: "POST" });
    await reload();
  }
  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/schedules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await reload();
  }
  async function remove(id: string) {
    if (!confirm("Delete this schedule?")) return;
    await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    await reload();
  }

  const targetOptions = targetKind === "dataset" ? datasets : dashboards;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Schedules</h2>

      <fieldset style={{ padding: "1rem", marginBottom: "1rem" }}>
        <legend>Create schedule</legend>
        <div style={{ display: "grid", gap: "0.5rem", maxWidth: 600 }}>
          <Row label="name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Row>
          <Row label="cron">
            <input
              value={cronExpr}
              onChange={(e) => setCron(e.target.value)}
              style={{ fontFamily: "ui-monospace, monospace" }}
              placeholder="m h dom mon dow"
            />
          </Row>
          <Row label="target">
            <span style={{ display: "flex", gap: "0.5rem" }}>
              <select value={targetKind} onChange={(e) => setTargetKind(e.target.value as "dataset" | "dashboard")}>
                <option value="dataset">dataset</option>
                <option value="dashboard">dashboard</option>
              </select>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ flex: 1 }}>
                <option value="">(pick)</option>
                {targetOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </span>
          </Row>
          <Row label="format">
            <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx" | "json")}>
              <option value="csv">csv</option>
              <option value="xlsx">xlsx</option>
              <option value="json">json</option>
            </select>
          </Row>
          <Row label="delivery">
            <span style={{ display: "flex", gap: "0.5rem" }}>
              <select value={deliveryKind} onChange={(e) => setDeliveryKind(e.target.value as "file" | "webhook")}>
                <option value="file">file</option>
                <option value="webhook">webhook</option>
              </select>
              {deliveryKind === "file" ? (
                <input
                  placeholder="dir under data/exports/"
                  value={deliveryDir}
                  onChange={(e) => setDeliveryDir(e.target.value)}
                  style={{ flex: 1 }}
                />
              ) : (
                <input
                  placeholder="https://example.com/hook"
                  value={deliveryUrl}
                  onChange={(e) => setDeliveryUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
              )}
            </span>
          </Row>
          <button onClick={() => void create()} disabled={busy} style={{ justifySelf: "start" }}>
            {busy ? "Saving..." : "Create"}
          </button>
        </div>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </fieldset>

      <h3>Existing</h3>
      {items.length === 0 ? (
        <p style={{ color: "#666" }}>No schedules yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr>
              {["name", "cron", "format", "delivery", "enabled", "last run", "actions"].map((h) => (
                <th key={h} style={{ borderBottom: "1px solid #ccc", padding: "4px 8px", textAlign: "left" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td style={cell}>{s.name}</td>
                <td style={cell}>
                  <code>{s.cron}</code>
                </td>
                <td style={cell}>{s.format}</td>
                <td style={cell}>
                  {s.delivery.kind} {s.delivery.url ?? s.delivery.dir}
                </td>
                <td style={cell}>
                  <input type="checkbox" checked={s.enabled} onChange={(e) => void toggle(s.id, e.target.checked)} />
                </td>
                <td style={cell}>
                  {s.lastRunAt ? (
                    <>
                      {new Date(s.lastRunAt).toLocaleString()}{" "}
                      <span style={{ color: s.lastStatus === "ok" ? "#16a34a" : "#dc2626" }}>{s.lastStatus}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={cell}>
                  <button onClick={() => void runNow(s.id)} style={{ marginRight: 4 }}>
                    run now
                  </button>
                  <button onClick={() => void remove(s.id)}>delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.5rem", alignItems: "center" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const cell: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid #eee" };
