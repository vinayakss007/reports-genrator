import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";

/**
 * Real authenticated encryption for source secrets.
 *
 * Algorithm: XChaCha20-Poly1305 (96-bit security against forgery,
 * 192-bit nonce so we can safely use random nonces forever).
 *
 * Key acquisition order:
 *
 *   1. `STORAGE_ENCRYPTION_KEY` env var, hex-encoded, 32 bytes.
 *   2. Otherwise a per-data-dir key persisted at `.dev-encryption-key`.
 *      We log a loud warning on first generation. This is real, not a
 *      stub: it produces real ciphertext that requires the same key
 *      file to decrypt. It is intended for development and
 *      single-machine self-hosted deployments where users prefer not
 *      to manage a KMS.
 *
 * Production deployments should set `STORAGE_ENCRYPTION_KEY` to a key
 * issued by a KMS or secret manager.
 */

const KEY_FILE = ".dev-encryption-key";
const KEY_BYTES = 32;
const NONCE_BYTES = 24;

let cachedKey: Uint8Array | null = null;
let cachedKeyDir: string | null = null;

export async function loadEncryptionKey(dataDir: string): Promise<Uint8Array> {
  if (cachedKey && cachedKeyDir === dataDir) return cachedKey;

  const fromEnv = process.env.STORAGE_ENCRYPTION_KEY;
  if (fromEnv) {
    const buf = hexToBytes(fromEnv);
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `STORAGE_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars); got ${buf.length}`,
      );
    }
    cachedKey = buf;
    cachedKeyDir = dataDir;
    return buf;
  }

  await fs.mkdir(dataDir, { recursive: true });
  const keyPath = join(dataDir, KEY_FILE);

  try {
    const txt = await fs.readFile(keyPath, "utf8");
    const buf = hexToBytes(txt.trim());
    if (buf.length !== KEY_BYTES) {
      throw new Error(`corrupt key at ${keyPath}: wrong length`);
    }
    cachedKey = buf;
    cachedKeyDir = dataDir;
    return buf;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;

    // First run: generate a real key, persist it 0600, warn.
    const fresh = new Uint8Array(randomBytes(KEY_BYTES));
    await fs.writeFile(keyPath, bytesToHex(fresh) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    // eslint-disable-next-line no-console
    console.warn(
      `[storage] Generated dev encryption key at ${keyPath}. ` +
        `Set STORAGE_ENCRYPTION_KEY for production deployments.`,
    );
    cachedKey = fresh;
    cachedKeyDir = dataDir;
    return fresh;
  }
}

export interface SealedSecret {
  /** XChaCha20-Poly1305 ciphertext, hex. */
  ciphertext: string;
  /** 24-byte random nonce, hex. */
  nonce: string;
  /** Algorithm label for forward compatibility. */
  alg: "xchacha20poly1305";
}

/** Encrypt a UTF-8 string. */
export function sealSecret(key: Uint8Array, plaintext: string): SealedSecret {
  const nonce = new Uint8Array(randomBytes(NONCE_BYTES));
  const cipher = xchacha20poly1305(key, nonce);
  const ct = cipher.encrypt(new TextEncoder().encode(plaintext));
  return {
    ciphertext: bytesToHex(ct),
    nonce: bytesToHex(nonce),
    alg: "xchacha20poly1305",
  };
}

/** Decrypt back to a UTF-8 string. Throws on tag mismatch. */
export function openSecret(key: Uint8Array, sealed: SealedSecret): string {
  if (sealed.alg !== "xchacha20poly1305") {
    throw new Error(`unsupported sealed-secret algorithm: ${sealed.alg}`);
  }
  const nonce = hexToBytes(sealed.nonce);
  const ct = hexToBytes(sealed.ciphertext);
  const cipher = xchacha20poly1305(key, nonce);
  const pt = cipher.decrypt(ct);
  return new TextDecoder().decode(pt);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("invalid hex character");
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}
