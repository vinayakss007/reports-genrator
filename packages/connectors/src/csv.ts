import { promises as fs } from "node:fs";
import Papa from "papaparse";
import { ConnectorError, type ReadOptions, type ReadResult } from "./types.js";

/**
 * Read a CSV file from disk and return rows + column names.
 *
 * Real implementation — reads the actual file with PapaParse. No mocks.
 *
 * - `header: true` treats the first row as column names.
 * - `dynamicTyping: false` so the deterministic profiler in
 *   `@reports/core` does its own typing. Doing it here would split
 *   the type inference across two places, which is exactly what we
 *   want to avoid.
 * - `skipEmptyLines: "greedy"` drops empty trailing rows.
 */
export async function readCsv(
  filePath: string,
  opts: ReadOptions = {},
): Promise<ReadResult> {
  const limit = Math.max(1, opts.limit ?? 10_000);

  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConnectorError(`csv file not found: ${filePath}`, "not_found");
    }
    if (code === "EACCES") {
      throw new ConnectorError(
        `cannot read csv: ${filePath}`,
        "permission_denied",
      );
    }
    throw new ConnectorError(
      `csv read failed: ${(err as Error).message}`,
      "parse_error",
    );
  }

  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    // Surface only the first parse error to keep the message bounded;
    // the rest are still available in the response if we want to log.
    const first = parsed.errors[0]!;
    if (first.code !== "TooFewFields" && first.code !== "TooManyFields") {
      throw new ConnectorError(
        `csv parse error at row ${first.row ?? "?"}: ${first.message}`,
        "parse_error",
      );
    }
  }

  const all = parsed.data;
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;
  const columns = parsed.meta.fields ?? [];

  return { columns, rows, truncated };
}
