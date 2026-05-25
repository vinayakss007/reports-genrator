import ExcelJS from "exceljs";
import { ConnectorError, type ReadOptions, type ReadResult } from "./types.js";

export interface XlsxReadOptions extends ReadOptions {
  /**
   * Optional sheet name. If omitted, the first sheet is read.
   */
  sheet?: string;
}

/**
 * Read an XLSX file from disk and return rows + column names.
 *
 * Real implementation using ExcelJS. The first row of the chosen sheet
 * is treated as column names. Cells are returned as their JS values
 * (Date for date cells, number for numeric, string otherwise) so the
 * downstream deterministic profiler can classify them uniformly.
 */
export async function readXlsx(
  filePath: string,
  opts: XlsxReadOptions = {},
): Promise<ReadResult> {
  const limit = Math.max(1, opts.limit ?? 10_000);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConnectorError(`xlsx file not found: ${filePath}`, "not_found");
    }
    throw new ConnectorError(
      `xlsx read failed: ${(err as Error).message}`,
      "parse_error",
    );
  }

  const sheet = opts.sheet ? wb.getWorksheet(opts.sheet) : wb.worksheets[0];
  if (!sheet) {
    throw new ConnectorError(
      opts.sheet
        ? `sheet not found: ${opts.sheet}`
        : "workbook has no sheets",
      "not_found",
    );
  }

  // Header row: first non-empty row.
  let headerRowIndex = 0;
  let columns: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, idx) => {
    if (headerRowIndex !== 0) return;
    const headerCells = row.values as unknown[];
    // ExcelJS row.values is 1-indexed; element 0 is undefined.
    columns = headerCells
      .slice(1)
      .map((c, i) => (c == null ? `col_${i + 1}` : String(c).trim()));
    headerRowIndex = idx;
  });

  if (headerRowIndex === 0) {
    return { columns: [], rows: [], truncated: false };
  }

  const rows: Record<string, unknown>[] = [];
  let truncated = false;

  sheet.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx <= headerRowIndex) return;
    if (rows.length >= limit) {
      truncated = true;
      return;
    }
    const obj: Record<string, unknown> = {};
    const cells = row.values as unknown[];
    for (let i = 0; i < columns.length; i++) {
      const name = columns[i]!;
      const cell = cells[i + 1];
      obj[name] = normalizeCell(cell);
    }
    rows.push(obj);
  });

  return { columns, rows, truncated };
}

/**
 * ExcelJS sometimes wraps values in objects (rich text, hyperlinks,
 * formulas). Reduce them to plain JS values so the profiler sees the
 * underlying data, not the cell envelope.
 */
function normalizeCell(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.result !== "undefined") return o.result; // formula result
    if (Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((p) => p.text).join("");
    }
    if (typeof o.hyperlink === "string") return o.hyperlink;
  }
  return v;
}
