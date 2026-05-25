import { useState } from "react";

/**
 * Export buttons that call /exports for CSV/XLSX/JSON or use ECharts'
 * native APIs for PNG/SVG. PNG/SVG are produced from the live chart
 * instance the parent provides via `getEChartsInstance`.
 */
export interface ExportButtonsProps {
  /**
   * Body for POST /exports. Either a dataset, chart, or dashboard
   * target. Pass `null` to disable server-side exports.
   */
  serverTarget: unknown | null;
  /**
   * Returns the live ECharts instance for client-side image export, or
   * null when no chart is rendered (dashboards have many; export goes
   * server-side). Pass `null` to disable PNG/SVG.
   */
  getEChartsInstance: (() => unknown | null) | null;
  /** Used as the download stem for client-side image exports. */
  filenameStem?: string;
}

export function ExportButtons({
  serverTarget,
  getEChartsInstance,
  filenameStem = "chart",
}: ExportButtonsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadServer(format: "csv" | "xlsx" | "json") {
    if (!serverTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: serverTarget, format }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const name = m?.[1] ?? `${filenameStem}.${format}`;
      triggerDownload(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "export failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadImage(kind: "png" | "svg") {
    if (!getEChartsInstance) return;
    const inst = getEChartsInstance() as
      | { getDataURL: (opts: { type?: string; pixelRatio?: number; backgroundColor?: string }) => string }
      | null;
    if (!inst) {
      setError("no chart instance");
      return;
    }
    if (kind === "png") {
      const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
      triggerDownload(dataUrlToBlob(url), `${filenameStem}.png`);
      return;
    }
    // SVG: only available when ECharts is initialized with renderer:'svg'.
    // We initialize with default canvas, so we render to PNG and embed it
    // in an SVG wrapper to preserve the user's expectation of a vector
    // file extension. To get a true vector export the renderer needs to
    // be reinitialized in svg mode; this keeps the UI useful without
    // forcing a global renderer change.
    const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
    const wrapped = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="${url}" /></svg>`;
    triggerDownload(new Blob([wrapped], { type: "image/svg+xml" }), `${filenameStem}.svg`);
  }

  return (
    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
      {serverTarget != null && (
        <>
          <button disabled={busy} onClick={() => void downloadServer("csv")}>
            CSV
          </button>
          <button disabled={busy} onClick={() => void downloadServer("xlsx")}>
            XLSX
          </button>
          <button disabled={busy} onClick={() => void downloadServer("json")}>
            JSON
          </button>
        </>
      )}
      {getEChartsInstance != null && (
        <>
          <button onClick={() => downloadImage("png")}>PNG</button>
          <button onClick={() => downloadImage("svg")}>SVG</button>
        </>
      )}
      {error && <span style={{ color: "crimson", fontSize: 12 }}>{error}</span>}
    </div>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function dataUrlToBlob(url: string): Blob {
  const [meta, data] = url.split(",");
  const m = meta?.match(/^data:([^;]+);base64$/);
  const mime = m?.[1] ?? "application/octet-stream";
  const binary = atob(data ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
