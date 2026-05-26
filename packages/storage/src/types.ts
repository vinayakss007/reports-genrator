import type { SourceKind } from "@reports/shared";

/** On-disk Source record. Secrets are kept out and stored separately. */
export interface StoredSource {
  id: string;
  /** Owning tenant. Every record is scoped to an Org. */
  orgId: string;
  kind: SourceKind;
  name: string;
  createdAt: string;
  /** For csv/xlsx sources, the upload this source is bound to. */
  uploadId?: string;
  /** For postgres sources, the non-secret connection fields. */
  postgres?: {
    host: string;
    port: number;
    database: string;
    user: string;
    ssl: boolean | "verify-full";
  };
}

/** On-disk Dataset record. A view over a Source. */
export interface StoredDataset {
  id: string;
  /** Owning tenant. Must match the parent Source's orgId. */
  orgId: string;
  sourceId: string;
  name: string;
  createdAt: string;
  /** XLSX-only sheet name, optional. */
  sheet?: string;
  /** Postgres SELECT query. Required for postgres sources. */
  query?: string;
}

/** On-disk Upload record. Tracks files written by /upload. */
export interface StoredUpload {
  id: string;
  /** Owning tenant. */
  orgId: string;
  filename: string;
  size: number;
  kind: "csv" | "xlsx";
  /** Absolute path on the API host. */
  path: string;
  createdAt: string;
}

/** On-disk Dashboard record. Layout + tiles. */
export interface StoredDashboard {
  id: string;
  /** Owning tenant. */
  orgId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  parameters: StoredParameter[];
  tiles: StoredTile[];
}

export interface StoredTile {
  id: string;
  title?: string;
  datasetId: string;
  spec: unknown;
  layout: { x: number; y: number; w: number; h: number };
}

export interface StoredParameter {
  name: string;
  field: string;
  op: string;
  value?: unknown;
}

/** On-disk Schedule record. Used by the in-process cron runner. */
export interface StoredSchedule {
  id: string;
  /** Owning tenant. The runner uses this to scope storage when firing. */
  orgId: string;
  name: string;
  cron: string;
  target: unknown;
  format: "csv" | "xlsx" | "json";
  delivery: StoredScheduleDelivery;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastMessage?: string;
}

export type StoredScheduleDelivery =
  | { kind: "webhook"; url: string; headers?: Record<string, string> }
  | { kind: "file"; dir: string }
  | { kind: "email"; to: string | string[]; subject?: string };

/** On-disk Org record. Tenant container for users + records. */
export interface StoredOrg {
  id: string;
  name: string;
  createdAt: string;
}

/** On-disk User record. Password is sealed via the secrets keyspace. */
export interface StoredUser {
  id: string;
  orgId: string;
  email: string;
  /** bcrypt hash, NOT a sealed secret — bcrypt is verified directly. */
  passwordHash: string;
  role: "owner" | "editor" | "viewer";
  createdAt: string;
}
