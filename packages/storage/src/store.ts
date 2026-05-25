import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { SealedSecret } from "./crypto.js";
import type {
  StoredDashboard,
  StoredDataset,
  StoredOrg,
  StoredSchedule,
  StoredSource,
  StoredUpload,
  StoredUser,
} from "./types.js";

/**
 * Atomic, single-process JSON file store.
 *
 * Schema versioning: v1 had sources/datasets/uploads/secrets only.
 * v2 added dashboards/schedules. v3 adds orgs/users.
 *
 * Concurrency model:
 *  - All writes go through a single in-process async mutex so reads
 *    and writes are serialized.
 *  - Writes use write-temp-then-rename for crash safety.
 *  - Readers read the latest in-memory snapshot after a hydrate.
 */

interface DiskShape {
  version: 3;
  sources: StoredSource[];
  datasets: StoredDataset[];
  uploads: StoredUpload[];
  dashboards: StoredDashboard[];
  schedules: StoredSchedule[];
  orgs: StoredOrg[];
  users: StoredUser[];
  secrets: Record<string, SealedSecret>;
}

const EMPTY: DiskShape = {
  version: 3,
  sources: [],
  datasets: [],
  uploads: [],
  dashboards: [],
  schedules: [],
  orgs: [],
  users: [],
  secrets: {},
};

export class JsonStore {
  private state: DiskShape = structuredClone(EMPTY);
  private hydrated = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    await fs.mkdir(dirname(this.path), { recursive: true });
    try {
      const raw = await fs.readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as { version?: number } & Record<string, unknown>;
      if (!parsed) throw new Error("empty store");
      const version = parsed.version;
      if (version === 1 || version === 2) {
        // Migrate forward: ensure every collection exists.
        this.state = {
          ...EMPTY,
          ...(parsed as object),
          version: 3,
          dashboards: (parsed.dashboards as StoredDashboard[]) ?? [],
          schedules: (parsed.schedules as StoredSchedule[]) ?? [],
          orgs: [],
          users: [],
        } as DiskShape;
        await this.persist(this.state);
      } else if (version === 3) {
        this.state = parsed as unknown as DiskShape;
      } else {
        throw new Error(`unsupported store version: ${version ?? "missing"}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await this.persist(this.state);
    }
    this.hydrated = true;
  }

  snapshot(): Readonly<DiskShape> {
    if (!this.hydrated) throw new Error("JsonStore.snapshot called before hydrate()");
    return this.state;
  }

  async update(mutator: (s: DiskShape) => DiskShape | void): Promise<void> {
    if (!this.hydrated) throw new Error("JsonStore.update called before hydrate()");
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
