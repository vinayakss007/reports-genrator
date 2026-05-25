import { PassThrough } from "node:stream";
import { promises as fs, createWriteStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ExportRequestSchema } from "@reports/shared";
import type { Storage } from "@reports/storage";
import { runExport, HttpError } from "../exports.js";

/**
 * Export endpoints.
 *
 *   POST /exports        - run an export and stream the result back as
 *                          an attachment.
 *   POST /exports/save   - run an export and save it under
 *                          ${DATA_DIR}/exports/<uuid>.<ext>; returns
 *                          { id, filename, contentType, sizeBytes }.
 *                          Used by the schedule runner and by the UI
 *                          when a user wants to keep the artifact.
 *   GET  /exports/:id    - download a saved export by id.
 */
export function registerExportRoutes(app: FastifyInstance, storage: Storage): void {
  app.post("/exports", async (req, reply) => {
    const parsed = ExportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { target, format } = parsed.data;
    // We use a PassThrough so we can capture the filename from runExport
    // before we set the response headers. Fastify gladly streams a Readable.
    const stream = new PassThrough();
    const finished = runExport({ storage, format, target, out: stream }).then(
      (r) => {
        stream.end();
        return r;
      },
      (err) => {
        stream.destroy(err);
        throw err;
      },
    );

    try {
      const result = await finished;
      reply.header("content-type", result.contentType);
      reply.header("content-disposition", `attachment; filename="${result.filename}"`);
      return reply.send(stream);
    } catch (err) {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ error: err.code, message: err.message });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "export_failed", message: (err as Error).message });
    }
  });

  app.post("/exports/save", async (req, reply) => {
    const parsed = ExportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const dir = join(storage.root, "exports");
    await fs.mkdir(dir, { recursive: true });
    const id = randomUUID();
    const ext = parsed.data.format;
    const path = join(dir, `${id}.${ext}`);

    const ws = createWriteStream(path, { flags: "wx", mode: 0o600 });
    try {
      const r = await runExport({
        storage,
        format: parsed.data.format,
        target: parsed.data.target,
        out: ws,
      });
      await new Promise<void>((resolve, reject) => {
        ws.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
      });
      const stat = await fs.stat(path);
      return reply.code(201).send({
        id,
        filename: r.filename,
        contentType: r.contentType,
        sizeBytes: stat.size,
        path,
      });
    } catch (err) {
      ws.destroy();
      await fs.unlink(path).catch(() => undefined);
      if (err instanceof HttpError) {
        return reply.code(err.status).send({ error: err.code, message: err.message });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "export_failed", message: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/exports/:id", async (req, reply) => {
    // We don't track exports in the metadata store (they are on-disk
    // artifacts keyed by uuid). Resolve by directory listing.
    const dir = join(storage.root, "exports");
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
    const match = entries.find((e) => e.startsWith(`${req.params.id}.`));
    if (!match) return reply.code(404).send({ error: "not_found" });
    const full = join(dir, match);
    const ext = match.split(".").pop() ?? "bin";
    const mime =
      ext === "csv"
        ? "text/csv"
        : ext === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : ext === "json"
            ? "application/json"
            : "application/octet-stream";
    reply.header("content-type", mime);
    reply.header("content-disposition", `attachment; filename="${match}"`);
    const buf = await fs.readFile(full);
    return reply.send(buf);
  });
}
