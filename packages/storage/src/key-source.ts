/**
 * KeySource interface for encryption key acquisition.
 *
 * Default implementation reads from env or a local file (the existing
 * `loadEncryptionKey` behavior). The KMS implementation calls an
 * external key management service to decrypt a sealed data key.
 *
 * To use KMS:
 *   1. Set KEY_SOURCE=kms
 *   2. Set KMS_KEY_ARN and KMS_REGION (AWS) or equivalent
 *   3. The sealed data key is stored at ${DATA_DIR}/.sealed-data-key
 *
 * The interface is intentionally minimal so it can be satisfied by
 * AWS KMS, GCP Cloud KMS, or Azure Key Vault with a thin adapter.
 */

export interface KeySource {
  /** Load (or decrypt) the 32-byte encryption key. */
  loadKey(dataDir: string): Promise<Uint8Array>;
}

/**
 * Local key source — the existing behavior. Reads from
 * STORAGE_ENCRYPTION_KEY env or generates + persists a dev key.
 * Exported as the default so callers don't need to change.
 */
export { loadEncryptionKey as localKeySource } from "./crypto.js";

/**
 * KMS key source placeholder. The real implementation would:
 *   1. Read ${DATA_DIR}/.sealed-data-key (the envelope-encrypted DEK).
 *   2. Call KMS Decrypt with the sealed bytes + the configured key ARN.
 *   3. Return the plaintext DEK (32 bytes).
 *
 * This module exports the interface and the seam; the actual KMS SDK
 * call is left as a one-file follow-up that imports @aws-sdk/client-kms
 * (or equivalent) behind the KEY_SOURCE=kms flag.
 */
export async function kmsKeySource(dataDir: string): Promise<Uint8Array> {
  const arn = process.env.KMS_KEY_ARN;
  if (!arn) throw new Error("KMS_KEY_ARN env var is required when KEY_SOURCE=kms");

  // The sealed data key file is created once during initial provisioning
  // (out of band or by a setup script that calls KMS GenerateDataKey).
  const { promises: fs } = await import("node:fs");
  const { join } = await import("node:path");
  const sealedPath = join(dataDir, ".sealed-data-key");

  let sealed: Buffer;
  try {
    sealed = await fs.readFile(sealedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `KMS sealed data key not found at ${sealedPath}. ` +
          `Run the setup script to generate one via KMS GenerateDataKey.`,
      );
    }
    throw err;
  }

  // --- Placeholder: replace with real KMS Decrypt call ---
  // import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
  // const client = new KMSClient({ region: process.env.KMS_REGION });
  // const result = await client.send(new DecryptCommand({
  //   CiphertextBlob: sealed,
  //   KeyId: arn,
  // }));
  // return new Uint8Array(result.Plaintext!);
  // -------------------------------------------------------

  throw new Error(
    "KMS decrypt not yet implemented. Install @aws-sdk/client-kms and " +
      "uncomment the KMS Decrypt call in packages/storage/src/key-source.ts",
  );
  // TypeScript requires a return but we threw above.
  void sealed;
}

/**
 * Resolve the active key source based on env. Called at Storage.open
 * time so the choice is made once and cached.
 */
export async function resolveKey(dataDir: string): Promise<Uint8Array> {
  const source = (process.env.KEY_SOURCE ?? "local").toLowerCase();
  if (source === "kms") return kmsKeySource(dataDir);
  const { loadEncryptionKey } = await import("./crypto.js");
  return loadEncryptionKey(dataDir);
}
