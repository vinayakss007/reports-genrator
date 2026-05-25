import { useEffect, useState } from "react";
import type { ChartSpec } from "../charts/types.js";

/**
 * "Save as tile" button. Creates a new dashboard or appends a tile to
 * an existing one. Calls real API endpoints; nothing in-memory.
 */
export interface SaveAsTileProps {
  datasetId: string;
  spec: ChartSpec;
  tileTitle: string;
  onSaved: (dashboardId: string) => void;
}

interface DashOption {
  id: string;
  name: string;
  tiles: { layout: { x: number; y: number; w: number; h: number } }[];
}

export function SaveAsTile({ datasetId, spec, tileTitle, onSaved }: SaveAsTileProps) {
  const [open, setOpen] = useState(false);
  const [dashboards, setDashboards] = useState<DashOption[]>([]);
  const [pickedId, setPickedId] = useState<string>("__new__");
  const [newName, setNewName] = useState("New dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch("/api/dashboards");
        if (res.ok) setDashboards((await res.json()) as DashOption[]);
      } catch {
        /* ignore */
      }
    })();
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const newTile = {
        title: tileTitle,
        datasetId,
        spec,
        layout: { x: 0, y: 0, w: 6, h: 6 },
      };
      let dashId: string;
      if (pickedId === "__new__") {
        const res = await fetch("/api/dashboards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName, tiles: [newTile] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        dashId = ((await res.json()) as { id: string }).id;
      } else {
        const existing = dashboards.find((d) => d.id === pickedId);
        if (!existing) throw new Error("dashboard not found");
        // Place new tile below the existing ones.
        const maxY = existing.tiles.reduce((m, t) => Math.max(m, t.layout.y + t.layout.h), 0);
        // Re-fetch full dashboard to get tile ids.
        const fullRes = await fetch(`/api/dashboards/${pickedId}`);
        if (!fullRes.ok) throw new Error(`HTTP ${fullRes.status}`);
        const full = (await fullRes.json()) as { tiles: unknown[] };
        const updatedTiles = [...full.tiles, { ...newTile, layout: { ...newTile.layout, y: maxY } }];
        const res = await fetch(`/api/dashboards/${pickedId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tiles: updatedTiles }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        dashId = pickedId;
      }
      setOpen(false);
      onSaved(dashId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}>Save as tile</button>
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div style={{ background: "white", padding: "1rem", borderRadius: 6, minWidth: 360 }}>
            <h3 style={{ marginTop: 0 }}>Save chart as tile</h3>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Dashboard:&nbsp;
              <select value={pickedId} onChange={(e) => setPickedId(e.target.value)}>
                <option value="__new__">+ New dashboard</option>
                {dashboards.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {pickedId === "__new__" && (
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                Name:&nbsp;
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            )}
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
              <button onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button onClick={() => void save()} disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
