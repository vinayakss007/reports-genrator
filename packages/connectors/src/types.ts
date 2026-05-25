/**
 * Shared connector types. Each connector returns the same shape so the
 * profiler and preview API can treat them uniformly.
 */

export type SourceKind = "csv" | "xlsx" | "postgres";

export interface ReadResult {
  /** Column names in insertion order. */
  columns: string[];
  /** Rows as plain objects keyed by column name. */
  rows: Record<string, unknown>[];
  /** True when the connector stopped at the row limit. */
  truncated: boolean;
}

export interface ReadOptions {
  /** Maximum rows to return. Connectors must respect this. */
  limit?: number;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "parse_error"
      | "connection_error"
      | "permission_denied"
      | "timeout"
      | "unsupported",
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
