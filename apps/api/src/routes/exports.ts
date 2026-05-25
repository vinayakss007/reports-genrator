import { PassThrough } from "node:stream";
import { promises as fs, createWriteStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ExportRequestSchema } from "@reports/shared";
import type { TenantResolver } from "../tenant.js";
import { runExport, HttpError } from "../exports.js";

/**
 * Export endpoints. Every export runs against the requesting user's
 * TenantStorage; cross-org targets surface as 404. Saved exports are
 * keyed by uuid under DATA_DIR/exports/<uuid>.<ext> with 0600 perms.
 */
export function registerExportRoutes(app: FastifyInstance, tenants: TenantResolver): void {
  app.post("/exports", async (req, reply) => {
    const parsed = ExportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const tenant = tenants.for(req);
    const { target, format } = parsed.data;
    const stream = new PassThrough();
    const finished = runExport({ tenant, format, target, out: stream }).then(
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
    const tenant = tenants.for(req);
    const dir = join(tenant.root, "exports");
    await fs.mkdir(dir, { recursive: true });
    const id = randomUUID();
    const ext = parsed.data.format;
    const path = join(dir, `${id}.${ext}`);

    const ws = createWriteStream(path, { flags: "wx", mode: 0o600 });
    try {
      const r = await runExport({
        tenant,
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
    // Saved exports live under DATA_DIR/exports/<uuid>.<ext>. We only
    // expose them to the requesting tenant; we accept the lookup but
    // there is no cross-tenant path because the dir is shared per
    // host, not per org. A follow-up could move exports under
    // exports/<orgId>/<uuid>.<ext>; for now access is gated on auth.
    const tenant = tenants.for(req);
    const dir = join(tenant.root, "exports");
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
