/**
 * Streaming JSON writer.
 *
 * Output shape:
 *   { columns: [...], rows: [ {...}, {...}, ... ] }
 *
 * Streams the rows array element-by-element so very large exports don't
 * materialize a single big string in memory.
 */

import type { Writable } from "node:stream";

export async function writeJson(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
  out: Writable,
): Promise<void> {
  const writeChunk = (s: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const ok = out.write(s, "utf8", (err) => (err ? reject(err) : resolve()));
      if (!ok) out.once("drain", resolve);
    });

  await writeChunk(`{"columns":${JSON.stringify(columns)},"rows":[`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const trimmed: Record<string, unknown> = {};
    for (const c of columns) trimmed[c] = row[c] ?? null;
    await writeChunk((i === 0 ? "" : ",") + JSON.stringify(trimmed));
  }
  await writeChunk("]}");
}
