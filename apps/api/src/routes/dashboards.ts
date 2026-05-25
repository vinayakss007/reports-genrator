import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  CreateDashboardRequestSchema,
  UpdateDashboardRequestSchema,
  type Tile,
} from "@reports/shared";
import type { Storage, StoredDashboard, StoredTile, StoredParameter } from "@reports/storage";

/**
 * Dashboards CRUD.
 *
 * Tiles and parameters are validated by the shared Zod schemas; the
 * server stores them as opaque blobs and re-validates on the way out
 * if a downstream needs strict shapes.
 */
export function registerDashboardRoutes(app: FastifyInstance, storage: Storage): void {
  app.post("/dashboards", async (req, reply) => {
    const parsed = CreateDashboardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const tiles: StoredTile[] = (parsed.data.tiles ?? []).map((t) => ({
      ...t,
      id: randomUUID(),
    }));
    const parameters: StoredParameter[] = (parsed.data.parameters ?? []).map((p) => ({
      name: p.name,
      field: p.field,
      op: p.op,
      value: p.value ?? null,
    }));
    const created = await storage.createDashboard({
      name: parsed.data.name,
      parameters,
      tiles,
    });
    return reply.code(201).send(created);
  });

  app.get("/dashboards", async () => storage.listDashboards());

  app.get<{ Params: { id: string } }>("/dashboards/:id", async (req, reply) => {
    const d = await storage.getDashboard(req.params.id);
    if (!d) return reply.code(404).send({ error: "not_found" });
    return d;
  });

  app.put<{ Params: { id: string } }>("/dashboards/:id", async (req, reply) => {
    const parsed = UpdateDashboardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    // For PUT we keep tile ids stable: any tile in the body without an id gets one.
    const tiles: StoredTile[] | undefined = parsed.data.tiles?.map((t: Tile) => ({
      ...t,
      id: t.id ?? randomUUID(),
    }));
    const parameters: StoredParameter[] | undefined = parsed.data.parameters?.map((p) => ({
      name: p.name,
      field: p.field,
      op: p.op,
      value: p.value ?? null,
    }));

    const patch: Partial<Pick<StoredDashboard, "name" | "parameters" | "tiles">> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parameters !== undefined) patch.parameters = parameters;
    if (tiles !== undefined) patch.tiles = tiles;

    const updated = await storage.updateDashboard(req.params.id, patch);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/dashboards/:id", async (req, reply) => {
    const ok = await storage.deleteDashboard(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
