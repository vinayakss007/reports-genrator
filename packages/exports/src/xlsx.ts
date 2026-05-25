/**
 * Real XLSX writer using ExcelJS.
 *
 * One worksheet per sheet input. Column headers become the first row.
 * Numeric values are written as numbers (not strings) so Excel formula
 * support and chart-from-table works.
 */

import ExcelJS from "exceljs";
import type { Writable } from "node:stream";

export interface XlsxSheet {
  /** Sheet name. ExcelJS truncates to 31 chars. */
  name: string;
  columns: readonly string[];
  rows: ReadonlyArray<Record<string, unknown>>;
}

export async function writeXlsx(sheets: readonly XlsxSheet[], out: Writable): Promise<void> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c, key: c }));
    for (const row of s.rows) {
      const obj: Record<string, unknown> = {};
      for (const c of s.columns) obj[c] = coerce(row[c]);
      ws.addRow(obj);
    }
    // Bold header row.
    ws.getRow(1).font = { bold: true };
  }
  await wb.xlsx.write(out);
}

function coerce(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    // Keep ISO datetimes as strings; Excel will recognize the format.
    return v;
  }
  return v;
}
