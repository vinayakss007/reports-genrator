import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { SealedSecret } from "./crypto.js";

/**
 * Atomic, single-process JSON file store.
 *
 * Why not SQLite for Phase 1? Native dependencies require build-script
 * approval in this sandbox and ship as a binary per platform. A JSON
 * store is real, persistent, and adequate for the small metadata
 * volumes we have (sources, datasets, uploads, dashboards, schedules).
 * It is documented as the seam to swap for Postgres in production.
 *
 * Concurrency model:
 *
 *  - All writes go through a single in-process async mutex so reads
 *    and writes are serialized. This is correct for a single API
 *    process and the documented v1 deployment.
 *  - Writes use write-temp-then-rename for crash safety.
 *  - Readers read the latest in-memory snapshot after a hydrate.
 */

import type {
  StoredDashboard,
  StoredDataset,
  StoredSchedule,
  StoredSource,
  StoredUpload,
} from "./types.js";

interface DiskShape {
  version: 2;
  sources: StoredSource[];
  datasets: StoredDataset[];
  uploads: StoredUpload[];
  dashboards: StoredDashboard[];
  schedules: StoredSchedule[];
  /** Sealed secrets keyed by source id. */
  secrets: Record<string, SealedSecret>;
}

const EMPTY: DiskShape = {
  version: 2,
  sources: [],
  datasets: [],
  uploads: [],
  dashboards: [],
  schedules: [],
  secrets: {},
};

export class JsonStore {
  private state: DiskShape = structuredClone(EMPTY);
  private hydrated = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** Load (or initialize) the store from disk. Idempotent. */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    await fs.mkdir(dirname(this.path), { recursive: true });
    try {
      const raw = await fs.readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as { version?: number } & Record<string, unknown>;
      if (!parsed) throw new Error("empty store");
      const version = parsed.version;
      // Migrate v1 -> v2 by adding empty dashboards/schedules.
      if (version === 1) {
        this.state = {
          ...EMPTY,
          ...(parsed as object),
          version: 2,
          dashboards: [],
          schedules: [],
        } as DiskShape;
        await this.persist(this.state);
      } else if (version === 2) {
        this.state = parsed as unknown as DiskShape;
      } else {
        throw new Error(`unsupported store version: ${version ?? "missing"}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // First run: write an empty store so subsequent reads are stable.
      await this.persist(this.state);
    }
    this.hydrated = true;
  }

  /** Read-only snapshot. Callers must not mutate the returned object. */
  snapshot(): Readonly<DiskShape> {
    if (!this.hydrated) {
      throw new Error("JsonStore.snapshot called before hydrate()");
    }
    return this.state;
  }

  /**
   * Run `mutator` against the current state and persist the result.
   * Mutations are serialized; a `mutator` should be pure and fast.
   */
  async update(mutator: (s: DiskShape) => DiskShape | void): Promise<void> {
    if (!this.hydrated) {
      throw new Error("JsonStore.update called before hydrate()");
    }
    // Chain writes so they never overlap.
    const run = async (): Promise<void> => {
      const draft: DiskShape = structuredClone(this.state);
      const result = mutator(draft);
      const next = result ?? draft;
      await this.persist(next);
      this.state = next;
    };
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  private async persist(s: DiskShape): Promise<void> {
    const tmp = join(dirname(this.path), `.${Date.now()}-${process.pid}.tmp`);
    const json = JSON.stringify(s, null, 2);
    await fs.writeFile(tmp, json, { encoding: "utf8" });
    await fs.rename(tmp, this.path);
  }
}
