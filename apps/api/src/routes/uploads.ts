import { promises as fs, createWriteStream } from "node:fs";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Storage } from "@reports/storage";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB v1 cap

/**
 * Multipart-file uploads.
 *
 *   POST /uploads        - upload a single CSV or XLSX file
 *   GET  /uploads        - list uploads (no file contents)
 *
 * The file is streamed straight to its final on-disk name
 * `${DATA_DIR}/uploads/<id>.<ext>` so we never keep two copies. The
 * upload record is written to the metadata store after a successful
 * write; on any failure the partial file is unlinked and no record is
 * created.
 */
export function registerUploadRoutes(app: FastifyInstance, storage: Storage): void {
  app.post("/uploads", async (req, reply) => {
    const data = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!data) return reply.code(400).send({ error: "missing_file" });

    const filename = basename(data.filename ?? "upload");
    const ext = filename.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "xlsx") {
      data.file.resume(); // drain so the connection closes cleanly
      return reply.code(415).send({
        error: "unsupported_extension",
        message: `only .csv and .xlsx are supported, got .${ext ?? "?"}`,
      });
    }

    const uploadDir = join(storage.root, "uploads");
    await fs.mkdir(uploadDir, { recursive: true });

    const id = randomUUID();
    const finalPath = join(uploadDir, `${id}.${ext}`);
    let bytes = 0;

    try {
      const ws = createWriteStream(finalPath, { flags: "wx", mode: 0o600 });
      data.file.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      await pipeline(data.file, ws);
    } catch (err) {
      await fs.unlink(finalPath).catch(() => undefined);
      return reply.code(400).send({
        error: "upload_failed",
        message: (err as Error).message,
      });
    }

    if (data.file.truncated) {
      await fs.unlink(finalPath).catch(() => undefined);
      return reply.code(413).send({
        error: "file_too_large",
        message: `max ${MAX_BYTES} bytes`,
      });
    }

    const upload = await storage.createUploadWithId(id, {
      filename,
      size: bytes,
      kind: ext as "csv" | "xlsx",
      path: finalPath,
    });

    return reply.code(201).send({
      id: upload.id,
      filename: upload.filename,
      size: upload.size,
      kind: upload.kind,
      createdAt: upload.createdAt,
    });
  });

  app.get("/uploads", async () => {
    const uploads = await storage.listUploads();
    return uploads.map((u) => ({
      id: u.id,
      filename: u.filename,
      size: u.size,
      kind: u.kind,
      createdAt: u.createdAt,
    }));
  });
}
