import { promises as fs, createWriteStream } from "node:fs";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { TenantResolver } from "../tenant.js";

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Multipart-file uploads. Files land under `${DATA_DIR}/uploads/<id>.
 * <ext>` 0600. The upload record carries the requesting user's orgId
 * so it is only visible to that tenant on subsequent reads.
 */
export function registerUploadRoutes(app: FastifyInstance, tenants: TenantResolver): void {
  app.post("/uploads", async (req, reply) => {
    const tenant = tenants.for(req);
    const data = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!data) return reply.code(400).send({ error: "missing_file" });

    const filename = basename(data.filename ?? "upload");
    const ext = filename.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "xlsx") {
      data.file.resume();
      return reply.code(415).send({
        error: "unsupported_extension",
        message: `only .csv and .xlsx are supported, got .${ext ?? "?"}`,
      });
    }

    const uploadDir = join(tenant.root, "uploads");
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

    const upload = await tenant.createUploadWithId(id, {
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

  app.get("/uploads", async (req) => {
    const uploads = await tenants.for(req).listUploads();
    return uploads.map((u) => ({
      id: u.id,
      filename: u.filename,
      size: u.size,
      kind: u.kind,
      createdAt: u.createdAt,
    }));
  });
}
