import { randomUUID } from "node:crypto";
import {
  loadEncryptionKey,
  openSecret,
  sealSecret,
  type SealedSecret,
} from "./crypto.js";
import { JsonStore } from "./store.js";
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
 * High-level storage facade.
 *
 *   Storage         the unscoped layer. Owns the JsonStore and the
 *                   encryption key. Used to manage Orgs and Users
 *                   (which are themselves the multi-tenant boundary)
 *                   and to look up a record without org context (rare
 *                   - typically from the Scheduler runner where the
 *                   schedule's own orgId narrows the scope).
 *
 *   TenantStorage   a per-org wrapper. Every list/get returns only
 *                   records belonging to the bound org; create methods
 *                   stamp the orgId automatically; cross-org get/
 *                   delete returns null/false (no existence leak).
 *
 * Routes obtain a TenantStorage via `storage.forOrg(req.principal.orgId
 * ?? defaultOrgId)` so a single call site is responsible for tenant
 * isolation. There is no path that reaches the unscoped Storage from
 * a request handler; the linter check is "every route imports
 * TenantStorage, never Storage directly".
 */
export class Storage {
  private constructor(
    private readonly store: JsonStore,
    private readonly encKey: Uint8Array,
    private readonly dataDir: string,
  ) {}

  static async open(dataDir: string): Promise<Storage> {
    const encKey = await loadEncryptionKey(dataDir);
    const store = new JsonStore(`${dataDir}/store.json`);
    await store.hydrate();
    return new Storage(store, encKey, dataDir);
  }

  get root(): string {
    return this.dataDir;
  }

  /** Construct a TenantStorage scoped to the given org. */
  forOrg(orgId: string): TenantStorage {
    return new TenantStorage(this, orgId);
  }

  // ----- internals exposed to TenantStorage -----

  /** @internal */ get _store(): JsonStore {
    return this.store;
  }
  /** @internal */ get _encKey(): Uint8Array {
    return this.encKey;
  }

  // ----- orgs (no tenant scope; orgs ARE the boundary) -----

  async listOrgs(): Promise<readonly StoredOrg[]> {
    return this.store.snapshot().orgs;
  }
  async getOrg(id: string): Promise<StoredOrg | null> {
    return this.store.snapshot().orgs.find((o) => o.id === id) ?? null;
  }
  async createOrg(input: Omit<StoredOrg, "id" | "createdAt">): Promise<StoredOrg> {
    const record: StoredOrg = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.store.update((s) => {
      s.orgs.push(record);
    });
    return record;
  }

  /** Ensure a default org exists; return its id. Idempotent. */
  async ensureDefaultOrg(name = "default"): Promise<string> {
    const orgs = await this.listOrgs();
    if (orgs.length > 0) return orgs[0]!.id;
    const fresh = await this.createOrg({ name });
    return fresh.id;
  }

  // ----- users (looked up by email globally, but assigned to an org) -----

  async listUsers(): Promise<readonly StoredUser[]> {
    return this.store.snapshot().users;
  }
  async getUser(id: string): Promise<StoredUser | null> {
    return this.store.snapshot().users.find((u) => u.id === id) ?? null;
  }
  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const lower = email.toLowerCase().trim();
    return this.store.snapshot().users.find((u) => u.email.toLowerCase() === lower) ?? null;
  }
  async createUser(input: Omit<StoredUser, "id" | "createdAt">): Promise<StoredUser> {
    const record: StoredUser = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.store.update((s) => {
      s.users.push(record);
    });
    return record;
  }
  async updateUserRole(id: string, role: StoredUser["role"]): Promise<StoredUser | null> {
    let updated: StoredUser | null = null;
    await this.store.update((s) => {
      const idx = s.users.findIndex((u) => u.id === id);
      if (idx < 0) return;
      const next: StoredUser = { ...s.users[idx]!, role };
      s.users[idx] = next;
      updated = next;
    });
    return updated;
  }
  async deleteUser(id: string): Promise<boolean> {
    let removed = false;
    await this.store.update((s) => {
      const before = s.users.length;
      s.users = s.users.filter((u) => u.id !== id);
      removed = s.users.length < before;
    });
    return removed;
  }

  // ----- low-level lookups used by the scheduler runner -----

  /** Look up a schedule across all orgs. The scheduler then narrows. */
  async getScheduleAnywhere(id: string): Promise<StoredSchedule | null> {
    return this.store.snapshot().schedules.find((s) => s.id === id) ?? null;
  }
  async listAllSchedules(): Promise<readonly StoredSchedule[]> {
    return this.store.snapshot().schedules;
  }
  async updateScheduleAnywhere(
    id: string,
    patch: Partial<Pick<StoredSchedule, "enabled" | "lastRunAt" | "lastStatus" | "lastMessage" | "name" | "cron" | "target" | "format" | "delivery">>,
  ): Promise<StoredSchedule | null> {
    let updated: StoredSchedule | null = null;
    await this.store.update((s) => {
      const idx = s.schedules.findIndex((x) => x.id === id);
      if (idx < 0) return;
      const next: StoredSchedule = { ...s.schedules[idx]!, ...patch };
      s.schedules[idx] = next;
      updated = next;
    });
    return updated;
  }

  /** Decrypt a sealed source password. Used by the preview pipeline. */
  async revealSourcePassword(orgId: string, id: string): Promise<string | null> {
    const src = this.store.snapshot().sources.find((s) => s.id === id && s.orgId === orgId);
    if (!src) return null;
    const sealed: SealedSecret | undefined = this.store.snapshot().secrets[id];
    if (!sealed) return null;
    return openSecret(this.encKey, sealed);
  }
}

/**
 * Per-tenant wrapper. Every list/get/create/delete here is scoped to
 * the bound `orgId`. Routes get one of these per request via
 * `storage.forOrg(orgId)` and never see the unscoped Storage.
 */
export class TenantStorage {
  constructor(
    private readonly storage: Storage,
    public readonly orgId: string,
  ) {}

  get root(): string {
    return this.storage.root;
  }

  // ----- uploads -----

  async listUploads(): Promise<readonly StoredUpload[]> {
    return this.storage._store.snapshot().uploads.filter((u) => u.orgId === this.orgId);
  }

  async getUpload(id: string): Promise<StoredUpload | null> {
    const u = this.storage._store.snapshot().uploads.find((x) => x.id === id);
    if (!u || u.orgId !== this.orgId) return null;
    return u;
  }

  async createUpload(input: Omit<StoredUpload, "id" | "orgId" | "createdAt">): Promise<StoredUpload> {
    return this.createUploadWithId(randomUUID(), input);
  }

  async createUploadWithId(
    id: string,
    input: Omit<StoredUpload, "id" | "orgId" | "createdAt">,
  ): Promise<StoredUpload> {
    const record: StoredUpload = {
      ...input,
      id,
      orgId: this.orgId,
      createdAt: new Date().toISOString(),
    };
    await this.storage._store.update((s) => {
      s.uploads.push(record);
    });
    return record;
  }

  // ----- sources -----

  async listSources(): Promise<readonly StoredSource[]> {
    return this.storage._store.snapshot().sources.filter((s) => s.orgId === this.orgId);
  }

  async getSource(id: string): Promise<StoredSource | null> {
    const s = this.storage._store.snapshot().sources.find((x) => x.id === id);
    if (!s || s.orgId !== this.orgId) return null;
    return s;
  }

  async createSource(
    input: Omit<StoredSource, "id" | "orgId" | "createdAt">,
    password?: string,
  ): Promise<StoredSource> {
    const id = randomUUID();
    const record: StoredSource = {
      ...input,
      id,
      orgId: this.orgId,
      createdAt: new Date().toISOString(),
    };
    const sealed = password ? sealSecret(this.storage._encKey, password) : null;
    await this.storage._store.update((s) => {
      s.sources.push(record);
      if (sealed) s.secrets[id] = sealed;
    });
    return record;
  }

  async deleteSource(id: string): Promise<boolean> {
    let removed = false;
    await this.storage._store.update((s) => {
      const before = s.sources.length;
      s.sources = s.sources.filter((src) => !(src.id === id && src.orgId === this.orgId));
      // Cascade datasets that belong to this source AND this org.
      s.datasets = s.datasets.filter(
        (d) => !(d.sourceId === id && d.orgId === this.orgId),
      );
      delete s.secrets[id];
      removed = s.sources.length < before;
    });
    return removed;
  }

  async revealSourcePassword(id: string): Promise<string | null> {
    return this.storage.revealSourcePassword(this.orgId, id);
  }

  // ----- datasets -----

  async listDatasets(): Promise<readonly StoredDataset[]> {
    return this.storage._store.snapshot().datasets.filter((d) => d.orgId === this.orgId);
  }

  async getDataset(id: string): Promise<StoredDataset | null> {
    const d = this.storage._store.snapshot().datasets.find((x) => x.id === id);
    if (!d || d.orgId !== this.orgId) return null;
    return d;
  }

  async createDataset(
    input: Omit<StoredDataset, "id" | "orgId" | "createdAt">,
  ): Promise<StoredDataset> {
    const record: StoredDataset = {
      ...input,
      id: randomUUID(),
      orgId: this.orgId,
      createdAt: new Date().toISOString(),
    };
    await this.storage._store.update((s) => {
      s.datasets.push(record);
    });
    return record;
  }

  async deleteDataset(id: string): Promise<boolean> {
    let removed = false;
    await this.storage._store.update((s) => {
      const before = s.datasets.length;
      s.datasets = s.datasets.filter((d) => !(d.id === id && d.orgId === this.orgId));
      removed = s.datasets.length < before;
    });
    return removed;
  }

  // ----- dashboards -----

  async listDashboards(): Promise<readonly StoredDashboard[]> {
    return this.storage._store.snapshot().dashboards.filter((d) => d.orgId === this.orgId);
  }

  async getDashboard(id: string): Promise<StoredDashboard | null> {
    const d = this.storage._store.snapshot().dashboards.find((x) => x.id === id);
    if (!d || d.orgId !== this.orgId) return null;
    return d;
  }

  async createDashboard(
    input: Omit<StoredDashboard, "id" | "orgId" | "createdAt" | "updatedAt">,
  ): Promise<StoredDashboard> {
    const now = new Date().toISOString();
    const record: StoredDashboard = {
      ...input,
      id: randomUUID(),
      orgId: this.orgId,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage._store.update((s) => {
      s.dashboards.push(record);
    });
    return record;
  }

  async updateDashboard(
    id: string,
    patch: Partial<Pick<StoredDashboard, "name" | "parameters" | "tiles">>,
  ): Promise<StoredDashboard | null> {
    let updated: StoredDashboard | null = null;
    await this.storage._store.update((s) => {
      const idx = s.dashboards.findIndex((d) => d.id === id && d.orgId === this.orgId);
      if (idx < 0) return;
      const next: StoredDashboard = {
        ...s.dashboards[idx]!,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      s.dashboards[idx] = next;
      updated = next;
    });
    return updated;
  }

  async deleteDashboard(id: string): Promise<boolean> {
    let removed = false;
    await this.storage._store.update((s) => {
      const before = s.dashboards.length;
      s.dashboards = s.dashboards.filter((d) => !(d.id === id && d.orgId === this.orgId));
      removed = s.dashboards.length < before;
    });
    return removed;
  }

  // ----- schedules -----

  async listSchedules(): Promise<readonly StoredSchedule[]> {
    return this.storage._store.snapshot().schedules.filter((s) => s.orgId === this.orgId);
  }

  async getSchedule(id: string): Promise<StoredSchedule | null> {
    const s = this.storage._store.snapshot().schedules.find((x) => x.id === id);
    if (!s || s.orgId !== this.orgId) return null;
    return s;
  }

  async createSchedule(
    input: Omit<StoredSchedule, "id" | "orgId" | "createdAt">,
  ): Promise<StoredSchedule> {
    const record: StoredSchedule = {
      ...input,
      id: randomUUID(),
      orgId: this.orgId,
      createdAt: new Date().toISOString(),
    };
    await this.storage._store.update((s) => {
      s.schedules.push(record);
    });
    return record;
  }

  async updateSchedule(
    id: string,
    patch: Partial<Pick<StoredSchedule, "enabled" | "lastRunAt" | "lastStatus" | "lastMessage" | "name" | "cron" | "target" | "format" | "delivery">>,
  ): Promise<StoredSchedule | null> {
    let updated: StoredSchedule | null = null;
    await this.storage._store.update((s) => {
      const idx = s.schedules.findIndex((x) => x.id === id && x.orgId === this.orgId);
      if (idx < 0) return;
      const next: StoredSchedule = { ...s.schedules[idx]!, ...patch };
      s.schedules[idx] = next;
      updated = next;
    });
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    let removed = false;
    await this.storage._store.update((s) => {
      const before = s.schedules.length;
      s.schedules = s.schedules.filter((x) => !(x.id === id && x.orgId === this.orgId));
      removed = s.schedules.length < before;
    });
    return removed;
  }
}
