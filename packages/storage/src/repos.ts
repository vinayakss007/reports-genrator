import { randomUUID } from "node:crypto";
import {
  loadEncryptionKey,
  openSecret,
  sealSecret,
  type SealedSecret,
} from "./crypto.js";
import { JsonStore } from "./store.js";
import type { StoredDataset, StoredSource, StoredUpload } from "./types.js";

/**
 * High-level storage facade. Holds a single JsonStore plus the cached
 * encryption key, and exposes typed CRUD methods for the API layer.
 *
 * All methods are real: they read and write actual files. There are no
 * in-memory-only paths.
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

  // ----- uploads -----

  async listUploads(): Promise<readonly StoredUpload[]> {
    return this.store.snapshot().uploads;
  }

  async getUpload(id: string): Promise<StoredUpload | null> {
    return this.store.snapshot().uploads.find((u) => u.id === id) ?? null;
  }

  async createUpload(input: Omit<StoredUpload, "id" | "createdAt">): Promise<StoredUpload> {
    return this.createUploadWithId(randomUUID(), input);
  }

  /**
   * Create an upload using a caller-provided id. Used by the upload
   * route so the file can be streamed to its final on-disk path before
   * the metadata record is committed.
   */
  async createUploadWithId(
    id: string,
    input: Omit<StoredUpload, "id" | "createdAt">,
  ): Promise<StoredUpload> {
    const record: StoredUpload = {
      ...input,
      id,
      createdAt: new Date().toISOString(),
    };
    await this.store.update((s) => {
      s.uploads.push(record);
    });
    return record;
  }

  // ----- sources -----

  async listSources(): Promise<readonly StoredSource[]> {
    return this.store.snapshot().sources;
  }

  async getSource(id: string): Promise<StoredSource | null> {
    return this.store.snapshot().sources.find((src) => src.id === id) ?? null;
  }

  /**
   * Create a source. If `password` is provided (only for postgres),
   * it is sealed and stored in the secrets keyspace.
   */
  async createSource(
    input: Omit<StoredSource, "id" | "createdAt">,
    password?: string,
  ): Promise<StoredSource> {
    const id = randomUUID();
    const record: StoredSource = {
      ...input,
      id,
      createdAt: new Date().toISOString(),
    };
    const sealed = password
      ? sealSecret(this.encKey, password)
      : null;
    await this.store.update((s) => {
      s.sources.push(record);
      if (sealed) s.secrets[id] = sealed;
    });
    return record;
  }

  async deleteSource(id: string): Promise<boolean> {
    let removed = false;
    await this.store.update((s) => {
      const before = s.sources.length;
      s.sources = s.sources.filter((src) => src.id !== id);
      s.datasets = s.datasets.filter((d) => d.sourceId !== id);
      delete s.secrets[id];
      removed = s.sources.length < before;
    });
    return removed;
  }

  /** Decrypt a source's stored password, or return null if none. */
  async revealSourcePassword(id: string): Promise<string | null> {
    const sealed: SealedSecret | undefined = this.store.snapshot().secrets[id];
    if (!sealed) return null;
    return openSecret(this.encKey, sealed);
  }

  // ----- datasets -----

  async listDatasets(): Promise<readonly StoredDataset[]> {
    return this.store.snapshot().datasets;
  }

  async getDataset(id: string): Promise<StoredDataset | null> {
    return this.store.snapshot().datasets.find((d) => d.id === id) ?? null;
  }

  async createDataset(
    input: Omit<StoredDataset, "id" | "createdAt">,
  ): Promise<StoredDataset> {
    const record: StoredDataset = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.store.update((s) => {
      s.datasets.push(record);
    });
    return record;
  }

  async deleteDataset(id: string): Promise<boolean> {
    let removed = false;
    await this.store.update((s) => {
      const before = s.datasets.length;
      s.datasets = s.datasets.filter((d) => d.id !== id);
      removed = s.datasets.length < before;
    });
    return removed;
  }
}
