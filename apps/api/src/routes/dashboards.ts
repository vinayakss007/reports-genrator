import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  CreateDashboardRequestSchema,
  UpdateDashboardRequestSchema,
  type Tile,
} from "@reports/shared";
import type { StoredDashboard, StoredTile, StoredParameter } from "@reports/storage";
import type { TenantResolver } from "../tenant.js";

/**
 * Dashboards CRUD. All operations go through TenantStorage so a user
 * can only see, edit, or delete dashboards inside their own org.
 */
export function registerDashboardRoutes(app: FastifyInstance, tenants: TenantResolver): void {
  app.post("/dashboards", async (req, reply) => {
    const parsed = CreateDashboardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const tenant = tenants.for(req);
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
    const created = await tenant.createDashboard({
      name: parsed.data.name,
      parameters,
      tiles,
    });
    return reply.code(201).send(created);
  });

  app.get("/dashboards", async (req) => tenants.for(req).listDashboards());

  app.get<{ Params: { id: string } }>("/dashboards/:id", async (req, reply) => {
    const d = await tenants.for(req).getDashboard(req.params.id);
    if (!d) return reply.code(404).send({ error: "not_found" });
    return d;
  });

  app.put<{ Params: { id: string } }>("/dashboards/:id", async (req, reply) => {
    const parsed = UpdateDashboardRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
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

    const updated = await tenants.for(req).updateDashboard(req.params.id, patch);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/dashboards/:id", async (req, reply) => {
    const ok = await tenants.for(req).deleteDashboard(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
