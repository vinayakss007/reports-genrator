/**
 * Real CSV writer. Pure deterministic: same rows + columns -> same bytes.
 *
 * RFC 4180-conformant quoting: any field containing a comma, double quote,
 * carriage return, or newline is wrapped in double quotes; double quotes
 * inside fields are doubled. Output uses CRLF line endings.
 *
 * Streams via Node's Writable to keep memory bounded for large exports.
 */

import { Writable } from "node:stream";

export interface WriteCsvOptions {
  /** If true, write a trailing newline after the last row. Default true. */
  finalNewline?: boolean;
}

export async function writeCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
  out: Writable,
  opts: WriteCsvOptions = {},
): Promise<void> {
  const finalNewline = opts.finalNewline ?? true;

  const writeChunk = (s: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const ok = out.write(s, "utf8", (err) => (err ? reject(err) : resolve()));
      if (!ok) {
        out.once("drain", resolve);
      }
    });

  await writeChunk(columns.map(escapeCsvField).join(",") + "\r\n");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const fields = columns.map((c) => escapeCsvField(row[c]));
    const isLast = i === rows.length - 1;
    await writeChunk(fields.join(",") + (isLast && !finalNewline ? "" : "\r\n"));
  }
}

/** RFC 4180 field encoder. Returns a UTF-8 string. */
export function escapeCsvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) {
    s = Number.isFinite(v.getTime()) ? v.toISOString() : "";
  } else if (typeof v === "object") {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
