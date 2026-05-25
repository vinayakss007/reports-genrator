import type { FastifyInstance } from "fastify";
import { ConnectorError } from "@reports/connectors";
import {
  CreateDatasetRequestSchema,
  PreviewRequestSchema,
} from "@reports/shared";
import type { Storage } from "@reports/storage";
import { runPreview } from "../preview.js";

/**
 * Dataset CRUD + preview.
 *
 * Dataset rules per source kind:
 *   - csv:    no extra config required.
 *   - xlsx:   `sheet` is optional (defaults to first sheet).
 *   - pg:     `query` is required.
 *
 * Preview reads up to `limit` rows from the bound source, computes a
 * deterministic profile via `@reports/core`, and returns both. The
 * profile is the same shape consumed by `/recommend-chart`.
 */
export function registerDatasetRoutes(app: FastifyInstance, storage: Storage): void {
  app.post("/datasets", async (req, reply) => {
    const parsed = CreateDatasetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const body = parsed.data;

    const src = await storage.getSource(body.sourceId);
    if (!src) return reply.code(404).send({ error: "source_not_found" });

    if (src.kind === "postgres" && !body.query) {
      return reply
        .code(400)
        .send({ error: "missing_query", message: "postgres datasets require a query" });
    }
    if (src.kind === "csv" && (body.sheet || body.query)) {
      return reply.code(400).send({
        error: "invalid_for_csv",
        message: "csv datasets do not accept sheet or query",
      });
    }
    if (src.kind === "xlsx" && body.query) {
      return reply.code(400).send({
        error: "invalid_for_xlsx",
        message: "xlsx datasets do not accept query",
      });
    }

    const ds = await storage.createDataset({
      sourceId: body.sourceId,
      name: body.name,
      sheet: body.sheet,
      query: body.query,
    });
    return reply.code(201).send(ds);
  });

  app.get("/datasets", async () => storage.listDatasets());

  app.get<{ Params: { id: string } }>("/datasets/:id", async (req, reply) => {
    const ds = await storage.getDataset(req.params.id);
    if (!ds) return reply.code(404).send({ error: "not_found" });
    return ds;
  });

  app.delete<{ Params: { id: string } }>("/datasets/:id", async (req, reply) => {
    const ok = await storage.deleteDataset(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/datasets/:id/preview",
    async (req, reply) => {
      const ds = await storage.getDataset(req.params.id);
      if (!ds) return reply.code(404).send({ error: "not_found" });
      const src = await storage.getSource(ds.sourceId);
      if (!src) return reply.code(404).send({ error: "source_not_found" });

      const parsed = PreviewRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", issues: parsed.error.issues });
      }

      try {
        const result = await runPreview(storage, src, ds, parsed.data.limit);
        return reply.send(result);
      } catch (err) {
        if (err instanceof ConnectorError) {
          return reply
            .code(400)
            .send({ error: err.code, message: err.message });
        }
        req.log.error(err);
        return reply
          .code(500)
          .send({ error: "preview_failed", message: (err as Error).message });
      }
    },
  );
}
