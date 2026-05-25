import {
  postgresQuery,
  readCsv,
  readXlsx,
  type ReadResult,
} from "@reports/connectors";
import { profileRows } from "@reports/core";
import type { Profile } from "@reports/shared";
import type { Storage, StoredDataset, StoredSource } from "@reports/storage";

/**
 * Run a deterministic preview for a dataset: read up to `limit` rows
 * from the bound source, sample-row-cap them, and compute a Profile.
 *
 * This is the bridge between the connectors and the recommender. Pure
 * orchestration — no AI involved.
 */
export interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  profile: Profile;
}

export async function runPreview(
  storage: Storage,
  source: StoredSource,
  dataset: StoredDataset,
  limit: number,
): Promise<PreviewResult> {
  let read: ReadResult;

  if (source.kind === "csv") {
    if (!source.uploadId) {
      throw new Error("csv source missing uploadId");
    }
    const upload = await storage.getUpload(source.uploadId);
    if (!upload) throw new Error(`upload not found: ${source.uploadId}`);
    read = await readCsv(upload.path, { limit });
  } else if (source.kind === "xlsx") {
    if (!source.uploadId) {
      throw new Error("xlsx source missing uploadId");
    }
    const upload = await storage.getUpload(source.uploadId);
    if (!upload) throw new Error(`upload not found: ${source.uploadId}`);
    read = await readXlsx(upload.path, { limit, sheet: dataset.sheet });
  } else if (source.kind === "postgres") {
    if (!source.postgres) {
      throw new Error("postgres source missing connection config");
    }
    if (!dataset.query) {
      throw new Error("postgres dataset requires a query");
    }
    const password = (await storage.revealSourcePassword(source.id)) ?? "";
    read = await postgresQuery(
      {
        ...source.postgres,
        password,
      },
      dataset.query,
      { limit },
    );
  } else {
    throw new Error(`unsupported source kind: ${(source as { kind: string }).kind}`);
  }

  const profile = profileRows(read.columns, read.rows);
  return { ...read, profile };
}
