import type { FastifyInstance } from "fastify";
import { ConnectorError } from "@reports/connectors";
import { CreateDatasetRequestSchema, PreviewRequestSchema } from "@reports/shared";
import { runPreview } from "../preview.js";
import type { TenantResolver } from "../tenant.js";

/**
 * Dataset CRUD + preview. Source lookups happen via the same
 * TenantStorage the dataset belongs to, so a foreign source cannot
 * be bound to a dataset across tenants.
 */
export function registerDatasetRoutes(app: FastifyInstance, tenants: TenantResolver): void {
  app.post("/datasets", async (req, reply) => {
    const parsed = CreateDatasetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const tenant = tenants.for(req);
    const body = parsed.data;

    const src = await tenant.getSource(body.sourceId);
    if (!src) return reply.code(404).send({ error: "source_not_found" });

    if (src.kind === "postgres" && !body.query) {
      return reply.code(400).send({ error: "missing_query", message: "postgres datasets require a query" });
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

    const ds = await tenant.createDataset({
      sourceId: body.sourceId,
      name: body.name,
      sheet: body.sheet,
      query: body.query,
    });
    return reply.code(201).send(ds);
  });

  app.get("/datasets", async (req) => tenants.for(req).listDatasets());

  app.get<{ Params: { id: string } }>("/datasets/:id", async (req, reply) => {
    const ds = await tenants.for(req).getDataset(req.params.id);
    if (!ds) return reply.code(404).send({ error: "not_found" });
    return ds;
  });

  app.delete<{ Params: { id: string } }>("/datasets/:id", async (req, reply) => {
    const ok = await tenants.for(req).deleteDataset(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>(
    "/datasets/:id/preview",
    async (req, reply) => {
      const tenant = tenants.for(req);
      const ds = await tenant.getDataset(req.params.id);
      if (!ds) return reply.code(404).send({ error: "not_found" });
      const src = await tenant.getSource(ds.sourceId);
      if (!src) return reply.code(404).send({ error: "source_not_found" });

      const parsed = PreviewRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      try {
        const result = await runPreview(tenant, src, ds, parsed.data.limit);
        return reply.send(result);
      } catch (err) {
        if (err instanceof ConnectorError) {
          return reply.code(400).send({ error: err.code, message: err.message });
        }
        req.log.error(err);
        return reply.code(500).send({ error: "preview_failed", message: (err as Error).message });
      }
    },
  );
}
