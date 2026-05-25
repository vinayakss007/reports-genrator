import type { SourceKind } from "@reports/shared";

/** On-disk Source record. Secrets are kept out and stored separately. */
export interface StoredSource {
  id: string;
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
  filename: string;
  size: number;
  kind: "csv" | "xlsx";
  /** Absolute path on the API host. */
  path: string;
  createdAt: string;
}
