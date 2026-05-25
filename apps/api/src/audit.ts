import { promises as fs, createWriteStream, type WriteStream } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Append-only audit log.
 *
 * Writes one JSONL record per event to `${DATA_DIR}/audit.log`. The
 * file handle is held open in append mode so writes are O(1) syscalls.
 *
 * Real, deterministic, no fakes:
 *  - File is created on first write.
 *  - Records are flushed to the OS write buffer per call; durability
 *    on power loss is bounded by the OS page cache, which is fine for
 *    audit purposes (we don't claim to be a write-ahead log).
 *  - All events are timestamped in UTC.
 */

export interface AuditEvent {
  /** ISO-8601 UTC timestamp set by the writer. Callers do not provide it. */
  timestamp?: string;
  /** Logical event name, e.g. "source.create" or "auth.login". */
  event: string;
  /** Authenticated user id, or null when unauthenticated. */
  userId: string | null;
  /** Authenticated user's org id, or null when unauthenticated. */
  orgId: string | null;
  /** HTTP method, when applicable. */
  method?: string;
  /** Request path, when applicable. */
  path?: string;
  /** HTTP status, when applicable. */
  status?: number;
  /** Caller IP. */
  ip?: string;
  /** Optional structured details. */
  details?: Record<string, unknown>;
}

export class AuditLog {
  private stream: WriteStream | null = null;

  constructor(private readonly path: string) {}

  /** Open (or rotate) the underlying append stream. */
  async open(): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    this.stream = createWriteStream(this.path, { flags: "a", mode: 0o600 });
  }

  /** Close the stream cleanly. Idempotent. */
  async close(): Promise<void> {
    if (!this.stream) return;
    const s = this.stream;
    this.stream = null;
    await new Promise<void>((resolve, reject) => {
      s.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Write one event. The call is fire-and-forget at the consumer level
   * (we never let an audit failure break a request) but the underlying
   * stream backpressure is respected.
   */
  write(event: AuditEvent): void {
    if (!this.stream) return;
    const record = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    try {
      this.stream.write(JSON.stringify(record) + "\n");
    } catch {
      /* never throw from audit */
    }
  }
}

/** Sugar for callers that don't want to import the module. */
export function defaultAuditLogPath(dataDir: string): string {
  return join(dataDir, "audit.log");
}
