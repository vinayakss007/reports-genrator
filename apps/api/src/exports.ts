import { writeCsv, writeXlsx, writeJson, EXPORT_EXTENSION, EXPORT_MIME } from "@reports/exports";
import type { ChartSpec, ExportFormat, ExportTarget } from "@reports/shared";
import type { Storage, StoredDashboard } from "@reports/storage";
import type { Writable } from "node:stream";
import { runPreview } from "./preview.js";
import { computeChart } from "./charts.js";

/**
 * Export pipeline.
 *
 * Resolves an ExportTarget to one or more rectangular row sets,
 * writes them to `out` in the requested format, and returns the
 * suggested filename. All deterministic; no AI involved.
 *
 *   - dataset target: read up to `limit` rows via the connector. Use
 *                     the dataset's own column order. CSV/XLSX/JSON.
 *   - chart target:   resolve the dataset, apply the spec via
 *                     computeChart, write the aggregated rows.
 *   - dashboard:      resolve every tile to a sheet (XLSX) or a
 *                     single concatenated CSV/JSON keyed by tile.
 */
export interface ExportContext {
  out: Writable;
  format: ExportFormat;
  target: ExportTarget;
  storage: Storage;
}

export interface ExportResult {
  filename: string;
  contentType: string;
}

export async function runExport(ctx: ExportContext): Promise<ExportResult> {
  const ext = EXPORT_EXTENSION[ctx.format];
  const mime = EXPORT_MIME[ctx.format];

  if (ctx.target.kind === "dataset") {
    const ds = await ctx.storage.getDataset(ctx.target.datasetId);
    if (!ds) throw notFound("dataset_not_found");
    const src = await ctx.storage.getSource(ds.sourceId);
    if (!src) throw notFound("source_not_found");
    const limit = ctx.target.limit ?? 100_000;
    const pv = await runPreview(ctx.storage, src, ds, limit);
    await write(ctx.format, ctx.out, [
      { name: ds.name.slice(0, 31), columns: pv.columns, rows: pv.rows },
    ]);
    return { filename: `${slug(ds.name)}.${ext}`, contentType: mime };
  }

  if (ctx.target.kind === "chart") {
    const ds = await ctx.storage.getDataset(ctx.target.datasetId);
    if (!ds) throw notFound("dataset_not_found");
    const src = await ctx.storage.getSource(ds.sourceId);
    if (!src) throw notFound("source_not_found");
    const pv = await runPreview(ctx.storage, src, ds, 100_000);
    const computed = computeChart(pv.rows, ctx.target.spec as ChartSpec);
    await write(ctx.format, ctx.out, [
      { name: ds.name.slice(0, 31), columns: computed.columns, rows: computed.rows },
    ]);
    return { filename: `${slug(ds.name)}_chart.${ext}`, contentType: mime };
  }

  // dashboard
  const dash = await ctx.storage.getDashboard(ctx.target.dashboardId);
  if (!dash) throw notFound("dashboard_not_found");
  const sheets = await dashboardToSheets(ctx.storage, dash);
  await write(ctx.format, ctx.out, sheets);
  return { filename: `${slug(dash.name)}.${ext}`, contentType: mime };
}

async function dashboardToSheets(
  storage: Storage,
  dashboard: StoredDashboard,
): Promise<Array<{ name: string; columns: string[]; rows: Record<string, unknown>[] }>> {
  const sheets: Array<{ name: string; columns: string[]; rows: Record<string, unknown>[] }> = [];
  // Convert dashboard parameters into filter rows merged into each tile spec.
  type SpecFilter = NonNullable<ChartSpec["filters"]>[number];
  const paramFilters: SpecFilter[] = dashboard.parameters
    .filter((p) => p.value !== null && p.value !== undefined && p.value !== "")
    .map((p) => {
      const value = p.value;
      if (Array.isArray(value)) {
        return {
          field: p.field,
          op: p.op as SpecFilter["op"],
          values: value as SpecFilter["values"],
        };
      }
      return {
        field: p.field,
        op: p.op as SpecFilter["op"],
        value: value as SpecFilter["value"],
      };
    });

  for (let i = 0; i < dashboard.tiles.length; i++) {
    const tile = dashboard.tiles[i]!;
    const ds = await storage.getDataset(tile.datasetId);
    if (!ds) continue;
    const src = await storage.getSource(ds.sourceId);
    if (!src) continue;
    const pv = await runPreview(storage, src, ds, 100_000);
    const spec = tile.spec as ChartSpec;
    const merged: ChartSpec = {
      ...spec,
      filters: [...(spec.filters ?? []), ...paramFilters],
    };
    const computed = computeChart(pv.rows, merged);
    sheets.push({
      name: (tile.title ?? `tile_${i + 1}`).slice(0, 31),
      columns: computed.columns,
      rows: computed.rows,
    });
  }
  return sheets;
}

async function write(
  format: ExportFormat,
  out: Writable,
  sheets: Array<{ name: string; columns: string[]; rows: Record<string, unknown>[] }>,
): Promise<void> {
  if (format === "xlsx") {
    await writeXlsx(sheets, out);
    return;
  }
  if (format === "csv") {
    if (sheets.length === 1) {
      await writeCsv(sheets[0]!.rows, sheets[0]!.columns, out);
      return;
    }
    // For multi-sheet CSV, concatenate with a sheet header line.
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i]!;
      const sep = i === 0 ? "" : "\r\n";
      out.write(`${sep}# ${s.name}\r\n`, "utf8");
      await writeCsv(s.rows, s.columns, out);
    }
    return;
  }
  // json
  if (sheets.length === 1) {
    await writeJson(sheets[0]!.rows, sheets[0]!.columns, out);
    return;
  }
  out.write(`{"sheets":[`, "utf8");
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i]!;
    if (i > 0) out.write(",", "utf8");
    out.write(`{"name":${JSON.stringify(s.name)},"data":`, "utf8");
    await writeJson(s.rows, s.columns, out);
    out.write(`}`, "utf8");
  }
  out.write(`]}`, "utf8");
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "export";
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function notFound(code: string): HttpError {
  return new HttpError(404, code, code);
}

export { HttpError };
