import { useEffect, useState } from "react";

interface Dashboard {
  id: string;
  name: string;
  tiles: unknown[];
  parameters: unknown[];
  updatedAt: string;
}

export function DashboardList({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Dashboard[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch("/api/dashboards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()) as Dashboard[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this dashboard?")) return;
    await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
    void reload();
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dashboards</h2>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {items.length === 0 ? (
        <p style={{ color: "#666" }}>
          No dashboards yet. Build a chart on the Build tab and click "Save as
          tile" to create one.
        </p>
      ) : (
        <ul>
          {items.map((d) => (
            <li key={d.id} style={{ marginBottom: "0.4rem" }}>
              <button onClick={() => onOpen(d.id)} style={{ marginRight: "0.5rem" }}>
                Open
              </button>
              <strong>{d.name}</strong>{" "}
              <span style={{ color: "#666", fontSize: 12 }}>
                · {d.tiles.length} tiles · updated {new Date(d.updatedAt).toLocaleString()}
              </span>{" "}
              <button onClick={() => void remove(d.id)} style={{ marginLeft: "0.5rem" }}>
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
