import pg from "pg";
import { ConnectorError, type ReadResult } from "./types.js";

const { Client } = pg;

/**
 * Real Postgres connector. Opens a single short-lived client per call,
 * runs one query bounded by `limit`, returns rows + columns.
 *
 * Pooling is intentionally NOT used at this layer; pool lifecycle is a
 * concern of the API process, not the connector. Phase 1 prefers
 * correctness and isolation.
 */

export interface PostgresConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /**
   * `true` enables TLS without certificate verification, suitable for
   * development with self-signed servers. Production deployments
   * should pass a CA via `ssl: "verify-full"` when supported.
   */
  ssl?: boolean | "verify-full";
  /** Connection timeout in milliseconds. Default 10000. */
  connectionTimeoutMs?: number;
  /** Statement timeout in milliseconds. Default 30000. */
  statementTimeoutMs?: number;
}

export interface PostgresQueryOptions {
  /** Row cap. Connector enforces it via SQL `LIMIT`. */
  limit?: number;
}

/**
 * Run a SELECT and return rows + column names.
 *
 * The connector wraps the user query in a subselect with a LIMIT to
 * avoid pulling unbounded results. We do NOT execute non-SELECT
 * statements: a leading-keyword check rejects anything that isn't
 * `SELECT` or `WITH`.
 */
export async function postgresQuery(
  conn: PostgresConnection,
  sql: string,
  opts: PostgresQueryOptions = {},
): Promise<ReadResult> {
  const limit = Math.max(1, opts.limit ?? 1000);

  assertSelectOnly(sql);

  const client = new Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    ssl: conn.ssl
      ? conn.ssl === "verify-full"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: conn.connectionTimeoutMs ?? 10_000,
    statement_timeout: conn.statementTimeoutMs ?? 30_000,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new ConnectorError(
      `postgres connect failed: ${(err as Error).message}`,
      "connection_error",
    );
  }

  try {
    // Truncate result set with an outer LIMIT so the server doesn't
    // materialize more than we need. We also fetch one extra row to
    // detect truncation without a second round trip.
    const wrapped = `SELECT * FROM (${sql}) AS user_query LIMIT $1`;
    const result = await client.query({
      text: wrapped,
      values: [limit + 1],
      rowMode: "array",
    });

    const fields = result.fields.map((f) => f.name);
    const rawRows = result.rows as unknown[][];
    const truncated = rawRows.length > limit;
    const rows = (truncated ? rawRows.slice(0, limit) : rawRows).map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < fields.length; i++) obj[fields[i]!] = row[i];
      return obj;
    });
    return { columns: fields, rows, truncated };
  } catch (err) {
    const msg = (err as Error).message;
    if (/timeout/i.test(msg)) {
      throw new ConnectorError(`postgres timeout: ${msg}`, "timeout");
    }
    throw new ConnectorError(`postgres query failed: ${msg}`, "parse_error");
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Reject anything that isn't a read-only query at the lexical level.
 * This is a defense-in-depth check, not a substitute for db-level
 * permissions.
 */
function assertSelectOnly(sql: string): void {
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .toLowerCase();
  if (!stripped.startsWith("select") && !stripped.startsWith("with")) {
    throw new ConnectorError(
      "only SELECT or WITH queries are allowed",
      "permission_denied",
    );
  }
  // Reject obvious write-side keywords appearing as standalone tokens.
  const denylist = [
    "insert ",
    "update ",
    "delete ",
    "drop ",
    "create ",
    "alter ",
    "grant ",
    "revoke ",
    "truncate ",
    "vacuum ",
    "copy ",
  ];
  for (const kw of denylist) {
    if (stripped.includes(kw)) {
      throw new ConnectorError(
        `query contains forbidden keyword: ${kw.trim()}`,
        "permission_denied",
      );
    }
  }
}

/**
 * Verify that a Postgres connection is reachable and credentials are
 * accepted. Used by `POST /sources` so users get fast feedback rather
 * than failing later at preview time.
 */
export async function postgresPing(conn: PostgresConnection): Promise<void> {
  const client = new Client({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    ssl: conn.ssl
      ? conn.ssl === "verify-full"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: conn.connectionTimeoutMs ?? 10_000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (err) {
    throw new ConnectorError(
      `postgres ping failed: ${(err as Error).message}`,
      "connection_error",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
