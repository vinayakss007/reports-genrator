import { useState } from "react";
import { BuildPage } from "./pages/BuildPage.js";
import { DashboardList } from "./dashboards/DashboardList.js";
import { DashboardView } from "./dashboards/DashboardView.js";
import { SchedulesPage } from "./schedules/SchedulesPage.js";

type Tab = "build" | "dashboards" | "schedules";

export function App() {
  const [tab, setTab] = useState<Tab>("build");
  const [openDashboardId, setOpenDashboardId] = useState<string | null>(null);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 1280,
        margin: "1rem auto",
        padding: "0 1rem",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Reports Generator</h1>
        <nav style={{ display: "flex", gap: "0.5rem" }}>
          {(["build", "dashboards", "schedules"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setOpenDashboardId(null);
              }}
              style={{
                padding: "0.3rem 0.7rem",
                background: tab === t ? "#2563eb" : "transparent",
                color: tab === t ? "white" : "#2563eb",
                border: "1px solid #2563eb",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      {tab === "build" && <BuildPage />}
      {tab === "dashboards" && !openDashboardId && (
        <DashboardList onOpen={(id) => setOpenDashboardId(id)} />
      )}
      {tab === "dashboards" && openDashboardId && (
        <DashboardView id={openDashboardId} onClose={() => setOpenDashboardId(null)} />
      )}
      {tab === "schedules" && <SchedulesPage />}
    </main>
  );
}
